param(
  [switch]$Apply,
  [string]$Source = 'supabase/.temp/upload-worker-source',
  [string]$IamMemberEmail = $env:UPLOAD_WORKER_IAM_MEMBER_EMAIL,
  [string]$Gcloud = 'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'
)
$ErrorActionPreference = 'Stop'
$taskProject = 'ai-hub-dev-510512'
$taskRegion = 'asia-northeast3'
$taskService = 'ai-hub-upload-parser'
$taskRuntime = "ai-hub-upload-parser@$taskProject.iam.gserviceaccount.com"
$taskBuilder = "ai-hub-upload-build@$taskProject.iam.gserviceaccount.com"
$taskNetwork = 'ai-hub-upload-parser'
$taskSubnet = 'ai-hub-upload-parser-seoul'
$taskTag = 'ai-hub-upload-parser'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskSource = [IO.Path]::GetFullPath((Join-Path $taskRoot $Source))
$taskAllowedRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'supabase/.temp')) + [IO.Path]::DirectorySeparatorChar
if (-not $taskSource.StartsWith($taskAllowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe source context.' }
function Invoke-UploadCloud {
  param([string[]]$Arguments, [string]$Stage)
  # Capture all CLI output. Never forward raw provider errors, identity tokens or credential data.
  $taskOutput = (& $Gcloud @Arguments --project=$taskProject --quiet 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Cloud command failed at $Stage; provider output suppressed." }
  return $taskOutput
}
$taskBilling = Invoke-UploadCloud @('billing','projects','describe',$taskProject,'--format=json(billingEnabled)') 'billing-check' | ConvertFrom-Json
if (-not $taskBilling.billingEnabled) {
  Write-Output 'NEEDS USER ACTION: AI Hub Dev billing is not enabled. No API/IAM/network/Cloud Run changes made.'
  exit 0
}
if (-not $Apply) {
  Write-Output 'READY: deployment plan only; use -Apply after the already-authorized project billing setup is complete.'
  exit 0
}
if ([string]::IsNullOrWhiteSpace($IamMemberEmail)) { throw 'IAM member email is required. Pass -IamMemberEmail or set UPLOAD_WORKER_IAM_MEMBER_EMAIL.' }
$taskExpected = @('Dockerfile','package.json','package-lock.json','.gcloudignore','workers/upload/server.mjs','workers/upload/isolate.mjs','workers/upload/child.mjs','workers/upload/parser.mjs')
$taskActual = @(Get-ChildItem -LiteralPath $taskSource -File -Recurse | ForEach-Object { $_.FullName.Substring($taskSource.Length + 1).Replace('\','/') })
if (@(Compare-Object ($taskExpected | Sort-Object) ($taskActual | Sort-Object)).Count -gt 0) { throw 'Unexpected build context files.' }
foreach ($taskFile in @('package.json','package-lock.json','workers/upload/server.mjs','workers/upload/isolate.mjs','workers/upload/child.mjs','workers/upload/parser.mjs')) {
  if ((Get-FileHash -LiteralPath (Join-Path $taskSource $taskFile)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $taskRoot $taskFile)).Hash) { throw 'Stale build context.' }
}
if ((Get-FileHash -LiteralPath (Join-Path $taskSource 'Dockerfile')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $taskRoot 'workers/upload/Dockerfile')).Hash) { throw 'Stale Dockerfile.' }
Invoke-UploadCloud @('services','enable','run.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','compute.googleapis.com','iam.googleapis.com') 'enable-required-apis' | Out-Null
# Fresh dedicated identities; never reuse the unrelated Gemini identity and never create JSON keys.
$taskAccounts = Invoke-UploadCloud @('iam','service-accounts','list','--format=json(email)') 'service-account-check' | ConvertFrom-Json
foreach ($taskAccount in @(@{Id='ai-hub-upload-parser';Email=$taskRuntime},@{Id='ai-hub-upload-build';Email=$taskBuilder})) {
  if (-not ($taskAccounts | Where-Object { $_.email -eq $taskAccount.Email })) {
    Invoke-UploadCloud @('iam','service-accounts','create',$taskAccount.Id,"--display-name=$($taskAccount.Id)") 'service-account-create' | Out-Null
  }
}
# Build permissions belong to the dedicated builder, not the runtime parser.
Invoke-UploadCloud @('projects','add-iam-policy-binding',$taskProject,"--member=serviceAccount:$taskBuilder",'--role=roles/run.builder','--condition=None') 'builder-permissions' | Out-Null
$taskNetworks = Invoke-UploadCloud @('compute','networks','list','--format=json(name)') 'network-check' | ConvertFrom-Json
if (-not ($taskNetworks | Where-Object { $_.name -eq $taskNetwork })) {
  Invoke-UploadCloud @('compute','networks','create',$taskNetwork,'--subnet-mode=custom','--bgp-routing-mode=regional') 'network-create' | Out-Null
}
$taskSubnets = Invoke-UploadCloud @('compute','networks','subnets','list',"--regions=$taskRegion",'--format=json(name)') 'subnet-check' | ConvertFrom-Json
if (-not ($taskSubnets | Where-Object { $_.name -eq $taskSubnet })) {
  Invoke-UploadCloud @('compute','networks','subnets','create',$taskSubnet,"--network=$taskNetwork","--region=$taskRegion",'--range=10.77.0.0/26','--no-enable-private-ip-google-access') 'subnet-create' | Out-Null
}
$taskFirewalls = Invoke-UploadCloud @('compute','firewall-rules','list','--format=json(name)') 'firewall-check' | ConvertFrom-Json
foreach ($taskRule in @(@{Name='ai-hub-upload-deny-egress-v4';Range='0.0.0.0/0'},@{Name='ai-hub-upload-deny-egress-v6';Range='::/0'})) {
  if (-not ($taskFirewalls | Where-Object { $_.name -eq $taskRule.Name })) {
    Invoke-UploadCloud @('compute','firewall-rules','create',$taskRule.Name,"--network=$taskNetwork",'--direction=EGRESS','--priority=100','--action=DENY','--rules=all',"--destination-ranges=$($taskRule.Range)","--target-tags=$taskTag") 'deny-parser-egress' | Out-Null
  }
}
Write-Output 'Deploying the private parser; Cloud Build may take several minutes. Raw logs are suppressed.'
Invoke-UploadCloud @('run','deploy',$taskService,"--source=$taskSource","--region=$taskRegion",'--no-allow-unauthenticated',"--service-account=$taskRuntime","--build-service-account=projects/$taskProject/serviceAccounts/$taskBuilder",'--concurrency=1','--max-instances=1','--min-instances=0','--cpu=1','--memory=512Mi','--timeout=120s','--execution-environment=gen2',"--network=$taskNetwork","--subnet=$taskSubnet","--network-tags=$taskTag",'--vpc-egress=all-traffic','--ingress=all') 'private-deploy' | Out-Null
Invoke-UploadCloud @('run','services','add-iam-policy-binding',$taskService,"--region=$taskRegion","--member=user:$IamMemberEmail",'--role=roles/run.invoker') 'developer-invoker' | Out-Null
$taskPolicy = Invoke-UploadCloud @('run','services','get-iam-policy',$taskService,"--region=$taskRegion",'--format=json') 'verify-private-policy' | ConvertFrom-Json
if ($taskPolicy.bindings.members -contains 'allUsers' -or $taskPolicy.bindings.members -contains 'allAuthenticatedUsers') { throw 'Public invocation detected; do not use worker.' }
$taskDescription = Invoke-UploadCloud @('run','services','describe',$taskService,"--region=$taskRegion",'--format=json') 'verify-service' | ConvertFrom-Json
if ($taskDescription.spec.template.spec.serviceAccountName -ne $taskRuntime -or $taskDescription.spec.template.spec.containerConcurrency -ne 1 -or $taskDescription.spec.template.spec.timeoutSeconds -ne 120) { throw 'Runtime deployment contract mismatch.' }
if ($taskDescription.metadata.annotations.'run.googleapis.com/invoker-iam-disabled' -eq 'true') { throw 'IAM invocation check disabled.' }
Write-Output 'PASS: private parser deployment and IAM/resource settings verified; authenticated smoke test still required. No OCR invocation performed.'
Write-Output "UPLOAD_WORKER_URL=$($taskDescription.status.url)"
