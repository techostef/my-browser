package com.techoky.obrowser.network

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class NetworkProxyModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "NetworkProxy"

  @ReactMethod
  fun apply(config: ReadableMap, promise: Promise) {
    val mode = config.getString("mode") ?: "off"
    val dohUrl = if (config.hasKey("dohUrl")) config.getString("dohUrl") else null
    val proxyUrl = if (config.hasKey("proxyUrl")) config.getString("proxyUrl") else null
    // Off the UI thread: starting the local server touches sockets.
    Thread {
      NetworkProxyManager.apply(mode, dohUrl, proxyUrl) { error ->
        if (error == null) promise.resolve(null) else promise.reject("E_NETWORK_PROXY", error)
      }
    }.start()
  }
}
