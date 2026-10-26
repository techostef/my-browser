package com.techoky.obrowser.network

import android.util.Log
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Minimal HTTP proxy on 127.0.0.1 that resolves hosts with [DohResolver].
 * HTTPS goes through CONNECT tunnels untouched (no TLS interception); plain
 * HTTP requests are rewritten to origin-form and forwarded with Connection: close.
 */
class LocalProxyServer(private val resolver: DohResolver) {
  private var server: ServerSocket? = null
  private val sockets: MutableSet<Socket> = Collections.newSetFromMap(ConcurrentHashMap())

  val port: Int get() = server?.localPort ?: -1

  @Synchronized
  fun start(): Int {
    server?.let { return it.localPort }
    val s = ServerSocket(0, 128, InetAddress.getByName("127.0.0.1"))
    server = s
    pool.execute { acceptLoop(s) }
    Log.i(TAG, "listening on 127.0.0.1:${s.localPort}")
    return s.localPort
  }

  @Synchronized
  fun stop() {
    runCatching { server?.close() }
    server = null
    sockets.forEach { runCatching { it.close() } }
    sockets.clear()
  }

  private fun acceptLoop(s: ServerSocket) {
    while (!s.isClosed) {
      val client = try {
        s.accept()
      } catch (e: IOException) {
        break
      }
      sockets.add(client)
      pool.execute { handle(client) }
    }
  }

  private fun handle(client: Socket) {
    var upstream: Socket? = null
    try {
      val input = BufferedInputStream(client.getInputStream())
      val output = client.getOutputStream()
      val head = readHead(input) ?: return
      val lines = head.split("\r\n")
      val parts = lines[0].split(" ")
      if (parts.size < 3) return
      val (method, target, version) = parts

      if (method.equals("CONNECT", ignoreCase = true)) {
        val (host, port) = splitHostPort(target, 443)
        upstream = connect(host, port)
        output.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
        output.flush()
        pipe(client, input, upstream)
        return
      }

      val uri = URI(target)
      val host = uri.host ?: return
      val port = if (uri.port > 0) uri.port else 80
      val path = (uri.rawPath?.ifEmpty { "/" } ?: "/") + (uri.rawQuery?.let { "?$it" } ?: "")
      val sb = StringBuilder("$method $path $version\r\n")
      for (line in lines.drop(1)) {
        if (line.isEmpty()) continue
        val name = line.substringBefore(':').trim().lowercase()
        if (name in HOP_HEADERS) continue
        sb.append(line).append("\r\n")
      }
      sb.append("Connection: close\r\n\r\n")
      upstream = connect(host, port)
      upstream.getOutputStream().apply {
        write(sb.toString().toByteArray(Charsets.ISO_8859_1))
        flush()
      }
      pipe(client, input, upstream)
    } catch (e: Exception) {
      Log.w(TAG, "request failed: ${e.message}")
      runCatching {
        client.getOutputStream().write(
          "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()
        )
      }
    } finally {
      close(client, upstream)
    }
  }

  private fun connect(host: String, port: Int): Socket {
    var last: Exception? = null
    for (addr in resolver.lookup(host)) {
      val socket = Socket(Proxy.NO_PROXY)
      try {
        socket.tcpNoDelay = true
        socket.connect(InetSocketAddress(addr, port), CONNECT_TIMEOUT_MS)
        sockets.add(socket)
        return socket
      } catch (e: IOException) {
        runCatching { socket.close() }
        last = e
      }
    }
    throw last ?: IOException("no address for $host")
  }

  /** Copies both directions; whichever side ends first tears down both sockets. */
  private fun pipe(client: Socket, clientIn: InputStream, upstream: Socket) {
    pool.execute {
      copy(clientIn, upstream.getOutputStream())
      close(client, upstream)
    }
    copy(upstream.getInputStream(), client.getOutputStream())
  }

  private fun copy(from: InputStream, to: OutputStream) {
    val buf = ByteArray(16 * 1024)
    try {
      while (true) {
        val n = from.read(buf)
        if (n < 0) break
        to.write(buf, 0, n)
        to.flush()
      }
    } catch (_: IOException) {
    }
  }

  private fun close(vararg s: Socket?) {
    for (socket in s) {
      if (socket == null) continue
      runCatching { socket.close() }
      sockets.remove(socket)
    }
  }

  /** Reads up to and including the blank line; leaves any body bytes in [input]. */
  private fun readHead(input: InputStream): String? {
    val buf = StringBuilder()
    var matched = 0
    while (buf.length < MAX_HEAD) {
      val b = input.read()
      if (b < 0) return null
      buf.append(b.toChar())
      matched = when {
        b == '\r'.code && (matched == 0 || matched == 2) -> matched + 1
        b == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
        else -> 0
      }
      if (matched == 4) return buf.substring(0, buf.length - 4)
    }
    return null
  }

  private fun splitHostPort(target: String, defaultPort: Int): Pair<String, Int> {
    if (target.startsWith("[")) {
      val end = target.indexOf(']')
      val host = target.substring(1, end)
      val port = target.substring(end + 1).removePrefix(":").toIntOrNull() ?: defaultPort
      return host to port
    }
    val idx = target.lastIndexOf(':')
    if (idx < 0) return target to defaultPort
    return target.substring(0, idx) to (target.substring(idx + 1).toIntOrNull() ?: defaultPort)
  }

  companion object {
    private const val TAG = "NetworkProxy"
    private const val MAX_HEAD = 64 * 1024
    private const val CONNECT_TIMEOUT_MS = 10_000
    private val HOP_HEADERS = setOf("proxy-connection", "proxy-authorization", "connection", "keep-alive")
    private val pool = Executors.newCachedThreadPool()
  }
}
