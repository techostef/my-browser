package com.techoky.obrowser.network

import java.net.Inet4Address
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps

/**
 * Resolves hostnames over DNS-over-HTTPS so lookups bypass the ISP's resolver
 * (which is where Internet Positif style blocking happens).
 */
class DohResolver(url: String) {
  private val dns: DnsOverHttps
  private val cache = ConcurrentHashMap<String, Pair<List<InetAddress>, Long>>()

  init {
    val httpUrl = url.toHttpUrl()
    // Must never go through our own proxy, or the lookup would loop.
    val client = OkHttpClient.Builder()
      .proxy(Proxy.NO_PROXY)
      .connectTimeout(10, TimeUnit.SECONDS)
      .readTimeout(10, TimeUnit.SECONDS)
      .build()
    val builder = DnsOverHttps.Builder().client(client).url(httpUrl).includeIPv6(true)
    // Bootstrap IPs keep the DoH server's own hostname off the system resolver.
    BOOTSTRAP[httpUrl.host]?.let { ips ->
      builder.bootstrapDnsHosts(ips.map { InetAddress.getByName(it) })
    }
    dns = builder.build()
  }

  @Throws(UnknownHostException::class)
  fun lookup(host: String): List<InetAddress> {
    if (isIpLiteral(host)) return listOf(InetAddress.getByName(host))
    val now = System.currentTimeMillis()
    cache[host]?.let { (addrs, expires) -> if (expires > now) return addrs }
    // IPv4 first: many mobile networks have broken IPv6 routes.
    val addrs = dns.lookup(host).sortedBy { if (it is Inet4Address) 0 else 1 }
    cache[host] = addrs to now + CACHE_TTL_MS
    return addrs
  }

  companion object {
    private const val CACHE_TTL_MS = 5 * 60 * 1000L

    private val BOOTSTRAP = mapOf(
      "cloudflare-dns.com" to listOf("1.1.1.1", "1.0.0.1"),
      "dns.google" to listOf("8.8.8.8", "8.8.4.4"),
      "dns.adguard-dns.com" to listOf("94.140.14.14", "94.140.15.15"),
    )

    private val IPV4 = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")

    fun isIpLiteral(host: String): Boolean = IPV4.matches(host) || host.contains(':')
  }
}
