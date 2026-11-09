import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceOperationRequest, attendanceReconciliationMessage } from '../src/services/attendanceOperationClient.ts';
import { pendingReconciliations } from '../src/helpers/hr/reconciliationStatus.js';

test('client retains an operation key across lost responses, partial results and module reloads',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  const values=new Map();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{
    getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),
  }});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'sessionStorage',original);else delete globalThis.sessionStorage;});
  const body={employeeUid:'isolated-uid',date:'2026-08-10',checkInTime:'08:00'};
  const initial=await attendanceOperationRequest('actor',body);
  const retry=await attendanceOperationRequest('actor',body);
  assert.equal(retry.body.operationId,initial.body.operationId);
  retry.finish({fullyCompleted:false,operation:{id:String(initial.body.operationId),status:'pending'}});
  const reloaded=await import('../src/services/attendanceOperationClient.ts?isolated-reload');
  const afterReload=await reloaded.attendanceOperationRequest('actor',body);
  assert.equal(afterReload.body.operationId,initial.body.operationId);
  assert.notEqual((await attendanceOperationRequest('different-actor',body)).body.operationId,initial.body.operationId);
  assert.notEqual((await attendanceOperationRequest('actor',{...body,checkInTime:'09:00'})).body.operationId,initial.body.operationId);
  afterReload.finish({fullyCompleted:true});
  assert.notEqual((await reloaded.attendanceOperationRequest('actor',body)).body.operationId,initial.body.operationId);
});

test('UI distinguishes saved attendance with pending or exhausted finance in Arabic and English',()=>{
  const operation={id:'isolated-op',status:'pending'};
  assert.match(attendanceReconciliationMessage({fullyCompleted:false,operation},true),/saved.*pending/);
  assert.match(attendanceReconciliationMessage({fullyCompleted:false,operation}),/تم حفظ.*قيد الاستكمال/);
  assert.match(attendanceReconciliationMessage({fullyCompleted:false,operation:{...operation,status:'needs_attention'}},true),/administrator review/);
  assert.equal(attendanceReconciliationMessage({fullyCompleted:true,operation:{...operation,status:'completed'}}),'');
  assert.deepEqual(pendingReconciliations({execution:{after:{payrollReconciliation:{fullyCompleted:false,operationId:'core-op',status:'pending'}}}}),[{id:'core-op',status:'pending'}]);
  assert.deepEqual(pendingReconciliations({status:'pending',id:'ordinary-request'}),[]);
});
