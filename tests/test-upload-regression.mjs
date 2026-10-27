// Reuses the one existing dev Doc identity without printing or widening the selection.
import {spawnSync} from 'node:child_process';
import {existingGoogleTest} from '../scripts/google-live-loader.mjs';
try{
 const context=await existingGoogleTest();const {data,error}=await context.admin.from('items').select('external_id').eq('user_id',context.connection.user_id).eq('source','drive').eq('format','document').limit(2);
 if(error||data?.length!==1||!data[0].external_id)throw new Error();
 const child=spawnSync(process.execPath,['tests/test-drive-live.mjs','--collect'],{env:{...process.env,DRIVE_LIVE_TEST_PROJECT:'oclzdppdiljbojvqtkeu',DRIVE_TEST_FILE_ID:data[0].external_id},encoding:'utf8',timeout:120000});
 // The called script intentionally emits only fixed safe progress labels.
 for(const line of (child.stdout??'').split(/\r?\n/))if(/^(PASS:|CLI )/.test(line))console.log(line);
 if(child.status!==0)throw new Error();
}catch{console.error('NOT VERIFIED: existing Drive regression; identities/payload/errors suppressed.');process.exitCode=1;}
