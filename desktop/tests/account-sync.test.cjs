'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {protocolTicket,protocolAutomatic}=require('../account-sync.cjs');
const ticket='a'.repeat(43);
test('account pairing only accepts a fixed desktop route and an opaque ticket',()=>{
  assert.equal(protocolTicket(['electron','xiaoqi-workbench://chat?ticket='+ticket]),ticket);
  assert.equal(protocolTicket(['xiaoqi-workbench://settings?renderStyle=2d&ticket='+ticket]),ticket);
  assert.equal(protocolTicket(['xiaoqi-workbench://pet?ticket='+ticket]),ticket);
  for(const value of ['https://untrusted.example/?ticket='+ticket,'xiaoqi-workbench://unknown?ticket='+ticket,'xiaoqi-workbench://chat?ticket=short','xiaoqi-workbench://chat?ticket='+ticket+'+','xiaoqi-workbench://chat'])assert.equal(protocolTicket([value]),null);
});

test('automatic pet launch is distinct from explicit workbench navigation',()=>{
  assert.equal(protocolAutomatic(['electron','xiaoqi-workbench://pet?ticket='+ticket]),true);
  for(const value of ['xiaoqi-workbench://chat?ticket='+ticket,'xiaoqi-workbench://settings','https://example.com/pet','xiaoqi-workbench://[','electron'])assert.equal(protocolAutomatic([value]),false);
});
