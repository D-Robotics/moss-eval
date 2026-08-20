import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandAdapter } from '../../src/adapters/command.mjs';

test('command adapter injects only named configured secrets and identifies them for safe Docker env passing',()=>{
  const previous=process.env.MOSS_EVAL_TEST_SECRET;
  process.env.MOSS_EVAL_TEST_SECRET='secret-value';
  try{
    const adapter=new CommandAdapter('agent',{adapter:'command',command:'agent',args:[],secret_env:['MOSS_EVAL_TEST_SECRET','MISSING_SECRET']});
    const command=adapter.build({id:'task',mode:'stream-json',instruction:'do it',environment:{env:{}}},{paths:{workspace:'/workspace',task:'/task',run:'/run',trial:'/run',eval:'/eval'},replicate:1,faultEnvironment:{}});
    assert.equal(command.env.MOSS_EVAL_TEST_SECRET,'secret-value');
    assert.equal(command.env.MISSING_SECRET,undefined);
    assert.deepEqual(command.metadata.secret_env_names,['MOSS_EVAL_TEST_SECRET','MISSING_SECRET']);
  }finally{if(previous===undefined)delete process.env.MOSS_EVAL_TEST_SECRET;else process.env.MOSS_EVAL_TEST_SECRET=previous;}
});
