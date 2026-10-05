import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {GoogleAuth} from 'google-auth-library';
const env={...process.env};
for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=/^([A-Z0-9_]+)=(.*)$/.exec(line);if(m&&!env[m[1]])env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');
}
const adc=env.GOOGLE_APPLICATION_CREDENTIALS;
const explicit=!!adc&&existsSync(adc),standard=existsSync(join(env.APPDATA??'', 'gcloud','application_default_credentials.json'));
console.log(JSON.stringify({workerConfigured:!!env.UPLOAD_WORKER_URL,ocrSwitch:env.UPLOAD_OCR_ENABLED==='true',projectConfigured:!!env.GOOGLE_CLOUD_PROJECT,projectMatches:env.GOOGLE_CLOUD_PROJECT==='ai-hub-dev-510512',explicitCredentialExists:explicit,standardAdcExists:standard}));
if(explicit||standard){
  try{const auth=new GoogleAuth({...(explicit?{keyFilename:adc}:{}),scopes:['https://www.googleapis.com/auth/cloud-platform']});console.log(JSON.stringify({adcProjectMatches:await auth.getProjectId()==='ai-hub-dev-510512',adcClientAvailable:!!await auth.getClient()}));}
  catch{console.log('ADC validation unavailable; credentials/errors suppressed.');}
}
