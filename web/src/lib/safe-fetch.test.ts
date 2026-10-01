import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedUrl, isPublicIp } from "./safe-fetch.ts";

test("public addresses pass, private and special ones don't", () => {
  for (const ok of ["8.8.8.8", "1.1.1.1", "140.82.112.3", "2606:4700:4700::1111"]) assert.equal(isPublicIp(ok), true, ok);
  for (const bad of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) assert.equal(isPublicIp(bad), false, bad);
});

test("only plain https addresses on public hosts are asked for", () => {
  assert.equal(allowedUrl(new URL("https://cdn.example.org/a.png")), true);
  for (const bad of ["http://cdn.example.org/a.png", "https://user:pw@cdn.example.org/a.png", "https://cdn.example.org:8443/a.png", "https://localhost/a.png", "https://printer.local/a.png", "https://intranet/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://169.254.169.254/latest/meta-data"]) assert.equal(allowedUrl(new URL(bad)), false, bad);
});
