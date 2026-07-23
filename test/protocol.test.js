import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decrypt } from 'tplink-smarthome-crypto';
import { buildDiscoveryRequest, parseDiscoveryReply, DISCOVERY_PORT } from '../src/tplink/protocol.js';
import { discoveryReply, PLUG_SYSINFO } from './helpers/fakeTpLink.js';

test('DISCOVERY_PORT is the classic Kasa LAN port', () => {
  assert.equal(DISCOVERY_PORT, 9999);
});

test('buildDiscoveryRequest forges the encrypted get_sysinfo probe (<= 512 bytes)', () => {
  const payload = buildDiscoveryRequest();
  assert.ok(Buffer.isBuffer(payload));
  assert.ok(payload.length <= 512);
  assert.equal(decrypt(payload).toString(), '{"system":{"get_sysinfo":{}}}');
});

test('parseDiscoveryReply decodes an encrypted reply back to its sysinfo', () => {
  const reply = discoveryReply('192.168.1.10', PLUG_SYSINFO);
  const sysInfo = parseDiscoveryReply(reply.payload_base64);
  assert.equal(sysInfo.deviceId, PLUG_SYSINFO.deviceId);
  assert.equal(sysInfo.alias, PLUG_SYSINFO.alias);
});

test('parseDiscoveryReply returns null on an unreadable payload', () => {
  assert.equal(parseDiscoveryReply('bm90LWthc2E='), null); // "not-kasa", not Kasa-encrypted
});

test('parseDiscoveryReply returns null when the reply has no deviceId', () => {
  const reply = discoveryReply('192.168.1.10', { alias: 'No id' });
  assert.equal(parseDiscoveryReply(reply.payload_base64), null);
});
