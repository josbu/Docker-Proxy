'use strict';

/**
 * SSRF 防护工具
 *
 */

const net = require('net');
const dns = require('dns');

// 受限网段（CIDR）：
//  - RFC1918 私有地址
//  - 链路本地（含云厂商元数据 169.254.169.254）
//  - 回环、CGNAT、保留/文档网段
//  - 对应 IPv6 范围（ULA、链路本地、回环、未指定、NAT64）
const RESTRICTED_CIDRS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '240.0.0.0/4',
  '255.255.255.255/32',
  // IPv6
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  '::/128',
  '64:ff9b::/96'
];

// 将 IPv4/IPv6 字面量转换为 BigInt（统一按 128 位处理）。
// 对 ::ffff:a.b.c.d（IPv4 映射地址）拆出其中的 IPv4 部分，按 IPv4 规则判断。
function ipToBigInt(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return (
      BigInt(parts[0]) * 2n ** 24n +
      BigInt(parts[1]) * 2n ** 16n +
      BigInt(parts[2]) * 2n ** 8n +
      BigInt(parts[3])
    );
  }
  if (!net.isIPv6(ip)) return null;

  const v6 = ip.toLowerCase();
  // IPv4 映射地址：提取末尾的 IPv4
  const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipToBigInt(mapped[1]);

  let head = '';
  let tail = '';
  if (v6.includes('::')) {
    const parts = v6.split('::');
    head = parts[0] || '';
    tail = parts[1] || '';
  } else {
    head = v6;
  }

  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groups = [];
  for (const g of headGroups) groups.push(parseInt(g || '0', 16));
  while (groups.length + tailGroups.length < 8) groups.push(0);
  for (const g of tailGroups) groups.push(parseInt(g || '0', 16));

  let big = 0n;
  for (const g of groups) big = (big << 16n) + BigInt(g);
  return big;
}

// 判断某个 IP 是否落在给定 CIDR 内。ip 与 cidr 的地址族需一致。
function inCidr(ip, cidr) {
  const idx = cidr.indexOf('/');
  const base = cidr.slice(0, idx);
  const bits = parseInt(cidr.slice(idx + 1), 10);

  const totalBits = net.isIPv4(base) ? 32 : 128;
  const ipBig = ipToBigInt(ip);
  const baseBig = ipToBigInt(base);
  if (ipBig === null || baseBig === null) return false;
  if (bits === 0) return true;

  const shift = BigInt(totalBits - bits);
  return (ipBig >> shift) === (baseBig >> shift);
}

// 判断一个 IP 字面量是否落在受限网段。
function isRestrictedAddress(ip) {
  if (net.isIP(ip) === 0) return false;
  for (const cidr of RESTRICTED_CIDRS) {
    if (inCidr(ip, cidr)) return true;
  }
  return false;
}

// 同步：仅对 IP 字面量做判断，域名返回 false（交由深层校验）。
function isRestrictedHost(host) {
  if (!host) return true;
  if (net.isIP(host) !== 0) return isRestrictedAddress(host);
  return false;
}

// 异步：对 IP 字面量直接判断；对域名做 DNS 解析后判断其所有解析结果。
function isRestrictedHostDeep(host) {
  return new Promise((resolve) => {
    if (!host) return resolve(true);
    if (net.isIP(host) !== 0) return resolve(isRestrictedAddress(host));
    dns.lookup(host, { all: true }, (err, addresses) => {
      if (err) return resolve(false);
      for (const a of addresses) {
        if (isRestrictedAddress(a.address)) return resolve(true);
      }
      resolve(false);
    });
  });
}

module.exports = {
  isRestrictedAddress,
  isRestrictedHost,
  isRestrictedHostDeep
};
