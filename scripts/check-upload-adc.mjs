// Secret-free readiness output; token is acquired only in memory and never serialized.
import {GoogleAuth} from 'google-auth-library';
const project='ai-hub-dev-510512';
try{
 const auth=new GoogleAuth({projectId:project,scopes:['https://www.googleapis.com/auth/cloud-platform']});
 const client=await auth.getClient(),access=await client.getAccessToken();
 console.log(JSON.stringify({adcClientAvailable:true,accessTokenAvailable:!!access.token,quotaProjectMatches:client.quotaProjectId===project}));
 if(!access.token)process.exitCode=1;
}catch{console.error('ADC token readiness unavailable; token/credentials/provider errors suppressed.');process.exitCode=1;}
