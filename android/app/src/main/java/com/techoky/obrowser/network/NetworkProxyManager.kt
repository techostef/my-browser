package com.techoky.obrowser.network

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.util.concurrent.Executor

/**
 * App-wide network routing: Off, Secure DNS (local DoH proxy) or a user proxy.
 * WebViews are routed with ProxyController; OkHttp clients (RN fetch,
 * expo-file-system downloads) pick it up through [AppProxySelector].
 */
object NetworkProxyManager {
  private const val TAG = "NetworkProxy"

  @Volatile private var javaProxy: Proxy? = null
  private var server: LocalProxyServer? = null

  /** Call once in Application.onCreate, before any OkHttpClient is built. */
  fun install() {
    val current = ProxySelector.getDefault()
    if (current !is AppProxySelector) ProxySelector.setDefault(AppProxySelector(current))
  }

  /**
   * @param mode "off" | "secureDns" | "proxy"
   * @param onDone called with null on success or an error message.
   */
  @Synchronized
  fun apply(mode: String, dohUrl: String?, proxyUrl: String?, onDone: (String?) -> Unit) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      onDone("WebView on this device does not support proxy override")
      return
    }
    server?.stop()
    server = null
    javaProxy = null

    val rule: String
    try {
      when (mode) {
        "secureDns" -> {
          val s = LocalProxyServer(DohResolver(dohUrl ?: throw IllegalArgumentException("DoH URL is empty")))
          val port = s.start()
          server = s
          rule = "http://127.0.0.1:$port"
          javaProxy = Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved("127.0.0.1", port))
        }
        "proxy" -> {
          val parsed = parseProxy(proxyUrl ?: "")
          rule = parsed.first
          javaProxy = parsed.second
        }
        else -> {
          mainHandler.post {
            ProxyController.getInstance().clearProxyOverride(DIRECT_EXECUTOR) { onDone(null) }
          }
          Log.i(TAG, "proxy override cleared")
          return
        }
      }
    } catch (e: Exception) {
      server?.stop()
      server = null
      javaProxy = null
      onDone(e.message ?: e.toString())
      return
    }

    val config = ProxyConfig.Builder().addProxyRule(rule).build()
    // ProxyController talks to WebView internals; keep it on the UI thread.
    mainHandler.post {
      try {
        ProxyController.getInstance().setProxyOverride(config, DIRECT_EXECUTOR) { onDone(null) }
      } catch (e: Exception) {
        onDone(e.message ?: e.toString())
      }
    }
    Log.i(TAG, "proxy override set: $mode -> $rule")
  }

  /** Accepts host:port, http://, https://, socks://, socks4:// or socks5:// URLs. */
  private fun parseProxy(raw: String): Pair<String, Proxy> {
    val input = raw.trim()
    if (input.isEmpty()) throw IllegalArgumentException("Proxy address is empty")
    val withScheme = if (input.contains("://")) input else "http://$input"
    val uri = URI(withScheme)
    val scheme = uri.scheme.lowercase()
    val host = uri.host ?: throw IllegalArgumentException("Invalid proxy address")
    if (uri.port <= 0) throw IllegalArgumentException("Proxy port is missing")
    return when (scheme) {
      "http", "https" ->
        "$scheme://$host:${uri.port}" to Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved(host, uri.port))
      "socks", "socks4", "socks5" ->
        "socks://$host:${uri.port}" to Proxy(Proxy.Type.SOCKS, InetSocketAddress.createUnresolved(host, uri.port))
      else -> throw IllegalArgumentException("Unsupported proxy scheme: $scheme")
    }
  }

  private val DIRECT_EXECUTOR = Executor { it.run() }
  private val mainHandler = Handler(Looper.getMainLooper())

  private class AppProxySelector(private val fallback: ProxySelector?) : ProxySelector() {
    override fun select(uri: URI?): List<Proxy> {
      val proxy = javaProxy
      val host = uri?.host
      val scheme = uri?.scheme?.lowercase()
      if (proxy != null && host != null && scheme in PROXIED_SCHEMES && !isLoopback(host)) {
        return listOf(proxy)
      }
      return fallback?.select(uri) ?: listOf(Proxy.NO_PROXY)
    }

    override fun connectFailed(uri: URI?, sa: SocketAddress?, ioe: IOException?) {
      fallback?.connectFailed(uri, sa, ioe)
    }

    private fun isLoopback(host: String) =
      host == "localhost" || host.startsWith("127.") || host == "::1" || host == "[::1]"

    companion object {
      private val PROXIED_SCHEMES = setOf("http", "https", "ws", "wss")
    }
  }
}
