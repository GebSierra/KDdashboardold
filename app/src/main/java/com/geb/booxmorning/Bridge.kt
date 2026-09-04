package com.geb.booxmorning

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * The JS <-> Kotlin bridge (exposed to the page as `window.Android`).
 *
 * The TickTick personal API token lives only here, in EncryptedSharedPreferences.
 * It is never handed to JavaScript, never logged, and never included in any value
 * passed back across the bridge.
 *
 * Every network call runs on a background coroutine; the result is delivered back
 * to the page by evaluating `window.__cb(callbackId, jsonString)` on the main thread,
 * matching the callback-id pattern app.js expects (see Section 4 of the dashboard plan).
 */
class Bridge(context: Context, private val webView: WebView) {

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            "boox_morning_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    companion object {
        private const val TOKEN_KEY = "ticktick_token"
        private const val BASE_URL = "https://api.ticktick.com"
    }

    fun shutdown() {
        scope.cancel()
    }

    // ---------- token management ----------

    @JavascriptInterface
    fun saveToken(token: String) {
        prefs.edit().putString(TOKEN_KEY, token).apply()
    }

    @JavascriptInterface
    fun hasToken(): Boolean {
        return !prefs.getString(TOKEN_KEY, null).isNullOrEmpty()
    }

    @JavascriptInterface
    fun clearToken() {
        prefs.edit().remove(TOKEN_KEY).apply()
    }

    private fun tokenOrNull(): String? = prefs.getString(TOKEN_KEY, null)

    // ---------- TickTick calls ----------

    @JavascriptInterface
    fun fetchHabits(cbId: String) {
        runHttp(cbId) { token ->
            httpRequest("$BASE_URL/open/v1/habit", "GET", token, null)
        }
    }

    @JavascriptInterface
    fun fetchCheckins(habitIdsCsv: String, from: String, to: String, cbId: String) {
        runHttp(cbId) { token ->
            val url = "$BASE_URL/open/v1/habit/checkins" +
                "?habitIds=" + java.net.URLEncoder.encode(habitIdsCsv, "UTF-8") +
                "&from=$from&to=$to"
            httpRequest(url, "GET", token, null)
        }
    }

    @JavascriptInterface
    fun checkin(habitId: String, stamp: String, value: String, goal: String, status: String, cbId: String) {
        runHttp(cbId) { token ->
            val body = "{\"stamp\":$stamp,\"value\":$value,\"goal\":$goal,\"status\":$status}"
            httpRequest("$BASE_URL/open/v1/habit/$habitId/checkin", "POST", token, body)
        }
    }

    // ---------- plumbing ----------

    private fun runHttp(cbId: String, block: (token: String) -> String) {
        val token = tokenOrNull()
        if (token.isNullOrEmpty()) {
            deliver(cbId, jsonError(401, "No TickTick token saved. Add one in Settings."))
            return
        }
        scope.launch {
            val result = try {
                block(token)
            } catch (e: Exception) {
                jsonError(0, e.message ?: "Network error")
            }
            withContext(Dispatchers.Main) {
                deliver(cbId, result)
            }
        }
    }

    private fun deliver(cbId: String, jsonResult: String) {
        val js = "window.__cb(" + jsQuote(cbId) + "," + jsQuote(jsonResult) + ")"
        webView.evaluateJavascript(js, null)
    }

    private fun httpRequest(urlString: String, method: String, token: String, body: String?): String {
        val url = URL(urlString)
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            if (body != null) {
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let { readAll(it) } ?: ""
            return if (code in 200..299) {
                if (text.isBlank()) "{}" else text
            } else {
                jsonError(code, text)
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun readAll(stream: java.io.InputStream): String {
        BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { reader ->
            return reader.readText()
        }
    }

    private fun jsonError(status: Int, body: String): String {
        return "{\"error\":true,\"status\":$status,\"body\":" + jsQuote(body) + "}"
    }

    /** Wrap a string as a JSON/JS string literal (double-quoted, escaped). */
    private fun jsQuote(s: String): String {
        val sb = StringBuilder(s.length + 2)
        sb.append('"')
        for (ch in s) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (ch.code < 0x20) {
                    sb.append(String.format("\\u%04x", ch.code))
                } else {
                    sb.append(ch)
                }
            }
        }
        sb.append('"')
        return sb.toString()
    }
}
