// Trusted, fixed helper code. Project data is passed separately; never interpolated as Python source.
export const prepareWorkspace = `import os,json,base64,sys
items=json.loads(sys.argv[1])
root=os.open('/workspace',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
for item in items:
 parts=item['path'].split('/')
 fd=os.dup(root)
 try:
  for part in parts[:-1]:
   try: os.mkdir(part,0o700,dir_fd=fd)
   except FileExistsError: pass
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
   os.close(fd); fd=child
  out=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
  with os.fdopen(out,'wb') as f: f.write(item['content'].encode('utf8'))
 finally: os.close(fd)
os.close(root)
`;

export const collectWorkspace = `import os,sys,json,stat,base64,signal,time
# Stop and kill remaining project descendants before reading outputs. The keeper has a different UID.
myself=os.getpid()
for attempt in range(10):
 targets=[]
 for entry in os.listdir('/proc'):
  if entry.isdigit() and int(entry)!=myself:
   try:
    if os.stat('/proc/'+entry).st_uid==os.getuid(): targets.append(int(entry))
   except FileNotFoundError: pass
 for pid in targets:
  try: os.kill(pid,signal.SIGSTOP)
  except ProcessLookupError: pass
 for pid in targets:
  try: os.kill(pid,signal.SIGKILL)
  except ProcessLookupError: pass
 if not targets: break
 time.sleep(0.02)
else: raise RuntimeError('Project processes did not quiesce')
remaining=int(sys.argv[2]); outputs=[]
root=os.open('/workspace',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
for path in json.loads(sys.argv[1]):
 fd=os.dup(root)
 try:
  parts=path.split('/')
  for part in parts[:-1]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
   os.close(fd); fd=child
  out=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
  with os.fdopen(out,'rb') as f:
   s=os.fstat(f.fileno())
   if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>remaining: raise RuntimeError('Unsafe output')
   data=f.read(remaining+1)
   if len(data)>remaining: raise RuntimeError('Output exceeds quota')
   remaining-=len(data)
   outputs.append({'path':path,'base64':base64.b64encode(data).decode('ascii')})
 finally: os.close(fd)
os.close(root)
print(json.dumps(outputs))
`;
