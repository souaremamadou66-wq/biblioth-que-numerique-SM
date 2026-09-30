import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';

const scrypt=promisify(scryptCallback);
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
await mkdir(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'bibliotheque-sm.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'reader', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, genre TEXT NOT NULL DEFAULT 'Romans', year INTEGER NOT NULL DEFAULT 2026, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'linear-gradient(145deg,#b57743,#78462e)', content TEXT NOT NULL DEFAULT '', available INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS loans(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, borrowed_at INTEGER NOT NULL, due_at INTEGER NOT NULL, renewal_count INTEGER NOT NULL DEFAULT 0, returned_at INTEGER);
CREATE INDEX IF NOT EXISTS loans_active_book ON loans(book_id,returned_at,due_at);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, PRIMARY KEY(user_id,book_id));`);
const seed=[
 ['Les voix du fleuve','Aïssata Koné','Romans',2024,'Au bord d’un fleuve qui traverse les générations, plusieurs voix se répondent et racontent l’amour, la mémoire et le courage de recommencer.','linear-gradient(145deg,#b57743,#78462e)'],
 ['La saison des mangues','Mariam Diallo','Littérature africaine',2023,'Dans un village où les saisons rythment les retrouvailles, une jeune femme cherche sa place entre héritage familial et nouveaux horizons.','linear-gradient(145deg,#647a62,#344b41)'],
 ['Les chemins de poussière','Ibrahim Traoré','Romans',2022,'Un récit sensible sur les départs, les liens qui résistent à la distance et les chemins qui finissent par nous ramener chez nous.','linear-gradient(145deg,#9b675d,#5b3540)'],
 ['Paroles de femmes','Fatoumata Camara','Histoire',2024,'Des portraits et des récits qui mettent en lumière les femmes ayant transformé leur époque et leur communauté.','linear-gradient(145deg,#72859b,#35485d)'],
 ['Le petit baobab','Amadou Sissoko','Jeunesse',2021,'Une aventure lumineuse pour les jeunes lecteurs, portée par la curiosité, l’amitié et un arbre plein de secrets.','linear-gradient(145deg,#c18a4f,#80522c)'],
 ['Mémoire des royaumes','Nana B. Ouédraogo','Histoire',2020,'Une introduction vivante aux histoires, aux échanges et aux héritages des royaumes d’Afrique de l’Ouest.','linear-gradient(145deg,#a4804e,#56442d)'],
 ['L’étoile du soir','Kadiatou Barry','Jeunesse',2023,'Quand une étoile disparaît du ciel, deux amis partent à sa recherche et découvrent la force de leur imagination.','linear-gradient(145deg,#7b6995,#423752)'],
 ['Penser demain','Moussa Traoré','Essais',2022,'Des pistes accessibles pour réfléchir à l’éducation, à la vie collective et aux idées qui peuvent façonner l’avenir.','linear-gradient(145deg,#537e83,#29494f)']
];
if(db.prepare('SELECT COUNT(*) n FROM books').get().n===0){const ins=db.prepare('INSERT INTO books(title,author,genre,year,description,color) VALUES(?,?,?,?,?,?)');for(const b of seed)ins.run(...b)}

const adminEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword=process.env.ADMIN_PASSWORD;
const hasAdmin=()=>db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
if(process.env.NODE_ENV==='production'&&!hasAdmin()&&!(adminEmail&&adminPassword))throw new Error('Définissez ADMIN_EMAIL et ADMIN_PASSWORD avant le premier démarrage en production.');
if(adminEmail&&adminPassword){
 if(adminPassword.length<14)throw new Error('ADMIN_PASSWORD doit contenir au moins 14 caractères.');
 const existing=db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail);
 if(!existing){const hash=await makePasswordHash(adminPassword);db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run('Administrateur SM',adminEmail,hash)}
 else db.prepare("UPDATE users SET role='admin' WHERE email=?").run(adminEmail);
}

function hashToken(token){return createHash('sha256').update(token).digest('hex')}
async function makePasswordHash(password){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return `scrypt$${salt}$${Buffer.from(key).toString('hex')}`}
async function verifyPassword(password,stored){const [kind,salt,key]=String(stored).split('$');if(kind!=='scrypt')return false;const actual=Buffer.from(await scrypt(password,salt,64));const expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected)}
function cookieToken(req){const value=req.headers.cookie||'';const match=value.match(/(?:^|;\s*)sm_session=([a-f0-9]{64})(?:;|$)/);return match?.[1]||null}
function setCookie(res,token,maxAge){res.setHeader('Set-Cookie',`sm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`)}
function sessionUser(req){const token=cookieToken(req);if(!token)return null;const row=db.prepare('SELECT u.id,u.name,u.email,u.role,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hashToken(token));if(!row||row.expires_at<Date.now()){if(row)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));return null}return row}
function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data))}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>2_000_000)throw Object.assign(new Error('Requête trop volumineuse.'),{status:413});chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return null}}
function activeLoans(userId){return db.prepare('SELECT l.id,l.book_id,l.borrowed_at,l.due_at,l.renewal_count,b.title,b.author,b.color FROM loans l JOIN books b ON b.id=l.book_id WHERE l.user_id=? AND l.returned_at IS NULL AND l.due_at>? ORDER BY l.due_at').all(userId,Date.now())}
function publicBook(row,userId){const active=db.prepare('SELECT COUNT(*) n FROM loans WHERE book_id=? AND returned_at IS NULL AND due_at>?').get(row.id,Date.now()).n;const mine=userId?db.prepare('SELECT id,due_at,renewal_count FROM loans WHERE book_id=? AND user_id=? AND returned_at IS NULL AND due_at>?').get(row.id,userId,Date.now()):null;return {id:row.id,title:row.title,author:row.author,genre:row.genre,year:row.year,description:row.description,color:row.color,label:row.title.length>23?row.title.slice(0,20)+'…':row.title,status:active?'Emprunté':'Disponible',new:row.year>=2024,popular:false,isBorrowedByMe:!!mine,dueAt:mine?.due_at||null}}
function bookRows(userId){return db.prepare('SELECT * FROM books ORDER BY created_at DESC,id DESC').all().map(row=>publicBook(row,userId))}
function cleanBook(input){if(!input||typeof input.title!=='string'||typeof input.author!=='string')return null;const title=input.title.trim(),author=input.author.trim();if(!title||!author||title.length>180||author.length>120)return null;const year=Number(input.year)||2026;return {title,author,genre:String(input.genre||'Romans').slice(0,80),year:Math.max(1000,Math.min(2100,year)),description:String(input.description||'').slice(0,3000),color:/^linear-gradient\([\w\s,#.%()-]+\)$/.test(String(input.color||''))?input.color:'linear-gradient(145deg,#b57743,#78462e)',content:String(input.content||'').slice(0,1_500_000)}}
function adminOnly(user,res){if(!user){send(res,401,{error:'Connectez-vous pour continuer.'});return false}if(user.role!=='admin'){send(res,403,{error:'Accès réservé à l’administration.'});return false}return true}
function readerOnly(user,res){if(!user){send(res,401,{error:'Connectez-vous pour continuer.'});return false}return true}
function staticFile(res,file,type){readFile(path.join(root,file)).then(data=>{res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self' 'unsafe-inline'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'"});res.end(data)}).catch(()=>send(res,404,{error:'Introuvable.'}))}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),user=sessionUser(req);
 try{
  if(req.method==='GET'&&url.pathname==='/'){staticFile(res,'index.html','text/html; charset=utf-8');return}
  if(req.method==='GET'&&url.pathname==='/integration.js'){staticFile(res,'integration.js','text/javascript; charset=utf-8');return}
  if(req.method==='GET'&&url.pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('ok');return}
  if(url.pathname.startsWith('/api/')){
   if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin){const origin=new URL(req.headers.origin).host;if(origin!==req.headers.host){send(res,403,{error:'Origine de requête refusée.'});return}}
   if(req.method==='GET'&&url.pathname==='/api/books'){send(res,200,{books:bookRows(user?.id||null)});return}
   if(req.method==='POST'&&url.pathname==='/api/register'){const x=await body(req);if(!x||typeof x.name!=='string'||typeof x.email!=='string'||typeof x.password!=='string'||x.name.trim().length<2||x.name.trim().length>100||!/^\S+@\S+\.\S+$/.test(x.email)||x.password.length<12){send(res,400,{error:'Entrez un nom, un courriel valide et un mot de passe d’au moins 12 caractères.'});return}const email=x.email.trim().toLowerCase();if(db.prepare('SELECT id FROM users WHERE email=?').get(email)){send(res,409,{error:'Cette adresse e-mail possède déjà un compte.'});return}const hash=await makePasswordHash(x.password);const info=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'reader')").run(x.name.trim(),email,hash);const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),Number(info.lastInsertRowid),Date.now()+7*86400000);setCookie(res,token,604800);send(res,201,{user:{id:Number(info.lastInsertRowid),name:x.name.trim(),email,role:'reader'}});return}
   if(req.method==='POST'&&url.pathname==='/api/login'){const x=await body(req);if(!x||typeof x.email!=='string'||typeof x.password!=='string'){send(res,400,{error:'Adresse e-mail et mot de passe requis.'});return}const row=db.prepare('SELECT id,name,email,password_hash,role FROM users WHERE email=?').get(x.email.trim().toLowerCase());if(!row||!await verifyPassword(x.password,row.password_hash)){send(res,401,{error:'Adresse e-mail ou mot de passe incorrect.'});return}const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),row.id,Date.now()+7*86400000);setCookie(res,token,604800);send(res,200,{user:{id:row.id,name:row.name,email:row.email,role:row.role}});return}
   if(req.method==='POST'&&url.pathname==='/api/logout'){const token=cookieToken(req);if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));setCookie(res,'',0);send(res,200,{ok:true});return}
   if(req.method==='GET'&&url.pathname==='/api/me'){send(res,200,{user:user?{id:user.id,name:user.name,email:user.email,role:user.role}:null});return}
   if(req.method==='GET'&&url.pathname==='/api/loans'){if(!readerOnly(user,res))return;send(res,200,{loans:activeLoans(user.id)});return}
   if(req.method==='POST'&&url.pathname==='/api/loans'){if(!readerOnly(user,res))return;const x=await body(req),bookId=Number(x?.bookId);if(!Number.isInteger(bookId)){send(res,400,{error:'Livre invalide.'});return}if(activeLoans(user.id).length>=3){send(res,409,{error:'La limite de trois emprunts simultanés est atteinte.'});return}if(db.prepare('SELECT id FROM books WHERE id=? AND available=1').get(bookId)===undefined){send(res,404,{error:'Livre introuvable.'});return}if(db.prepare('SELECT id FROM loans WHERE book_id=? AND returned_at IS NULL AND due_at>?').get(bookId,Date.now())){send(res,409,{error:'Ce livre est déjà emprunté.'});return}const now=Date.now();const result=db.prepare('INSERT INTO loans(user_id,book_id,borrowed_at,due_at) VALUES(?,?,?,?)').run(user.id,bookId,now,now+14*86400000);send(res,201,{loanId:Number(result.lastInsertRowid),dueAt:now+14*86400000});return}
   if(req.method==='POST'&&url.pathname==='/api/favorites'){if(!readerOnly(user,res))return;const x=await body(req),bookId=Number(x?.bookId);if(!db.prepare('SELECT id FROM books WHERE id=?').get(bookId)){send(res,404,{error:'Livre introuvable.'});return}const existing=db.prepare('SELECT 1 n FROM favorites WHERE user_id=? AND book_id=?').get(user.id,bookId);if(existing)db.prepare('DELETE FROM favorites WHERE user_id=? AND book_id=?').run(user.id,bookId);else db.prepare('INSERT INTO favorites(user_id,book_id) VALUES(?,?)').run(user.id,bookId);send(res,200,{favorite:!existing});return}
   if(req.method==='GET'&&url.pathname==='/api/favorites'){if(!readerOnly(user,res))return;const ids=db.prepare('SELECT book_id FROM favorites WHERE user_id=?').all(user.id).map(x=>x.book_id);send(res,200,{ids});return}
   const loanMatch=url.pathname.match(/^\/api\/loans\/(\d+)\/(return|renew)$/);if(req.method==='POST'&&loanMatch){if(!readerOnly(user,res))return;const loan=db.prepare('SELECT id,book_id,due_at,renewal_count FROM loans WHERE id=? AND user_id=? AND returned_at IS NULL').get(Number(loanMatch[1]),user.id);if(!loan){send(res,404,{error:'Emprunt introuvable.'});return}if(loanMatch[2]==='return'){db.prepare('UPDATE loans SET returned_at=? WHERE id=?').run(Date.now(),loan.id);send(res,200,{ok:true});return}if(loan.renewal_count>0){send(res,409,{error:'Cet emprunt a déjà été renouvelé.'});return}if(db.prepare('SELECT id FROM loans WHERE book_id=? AND user_id<>? AND returned_at IS NULL AND due_at>?').get(loan.book_id,user.id,Date.now())){send(res,409,{error:'Ce livre est réservé par un autre lecteur.'});return}const dueAt=Math.max(loan.due_at,Date.now())+7*86400000;db.prepare('UPDATE loans SET due_at=?,renewal_count=renewal_count+1 WHERE id=?').run(dueAt,loan.id);send(res,200,{dueAt});return}
   const readMatch=url.pathname.match(/^\/api\/books\/(\d+)\/read$/);if(req.method==='GET'&&readMatch){if(!readerOnly(user,res))return;const bookId=Number(readMatch[1]);const allowed=db.prepare('SELECT id FROM loans WHERE user_id=? AND book_id=? AND returned_at IS NULL AND due_at>?').get(user.id,bookId,Date.now());if(!allowed){send(res,403,{error:'Empruntez ce livre pour accéder à la lecture.'});return}const book=db.prepare('SELECT id,title,content FROM books WHERE id=?').get(bookId);if(!book){send(res,404,{error:'Livre introuvable.'});return}send(res,200,{book});return}
   if(url.pathname.startsWith('/api/admin/')&&!adminOnly(user,res))return;
   if(req.method==='GET'&&url.pathname==='/api/admin/books'){send(res,200,{books:db.prepare('SELECT * FROM books ORDER BY id DESC').all()});return}
   if(req.method==='POST'&&url.pathname==='/api/admin/books'){const x=cleanBook(await body(req));if(!x){send(res,400,{error:'Titre et auteur sont requis.'});return}const r=db.prepare('INSERT INTO books(title,author,genre,year,description,color,content) VALUES(?,?,?,?,?,?,?)').run(x.title,x.author,x.genre,x.year,x.description,x.color,x.content);send(res,201,{id:Number(r.lastInsertRowid)});return}
   const bookMatch=url.pathname.match(/^\/api\/admin\/books\/(\d+)$/);if(bookMatch&&req.method==='PUT'){const x=cleanBook(await body(req));if(!x){send(res,400,{error:'Titre et auteur sont requis.'});return}const r=db.prepare('UPDATE books SET title=?,author=?,genre=?,year=?,description=?,color=?,content=? WHERE id=?').run(x.title,x.author,x.genre,x.year,x.description,x.color,x.content,Number(bookMatch[1]));send(res,r.changes?200:404,{ok:!!r.changes});return}if(bookMatch&&req.method==='DELETE'){const r=db.prepare('DELETE FROM books WHERE id=?').run(Number(bookMatch[1]));send(res,r.changes?200:404,{ok:!!r.changes});return}
   if(req.method==='GET'&&url.pathname==='/api/admin/loans'){if(!adminOnly(user,res))return;send(res,200,{loans:db.prepare('SELECT l.id,l.borrowed_at,l.due_at,l.renewal_count,u.name,u.email,b.title FROM loans l JOIN users u ON u.id=l.user_id JOIN books b ON b.id=l.book_id WHERE l.returned_at IS NULL ORDER BY l.due_at').all()});return}
   send(res,404,{error:'Route introuvable.'});return;
  }
  send(res,404,{error:'Introuvable.'});
 }catch(err){console.error(err);send(res,err.status||500,{error:err.status?err.message:'Une erreur interne est survenue.'})}
});
const port=Number(process.env.PORT)||3000;server.listen(port,'0.0.0.0',()=>console.log(`Bibliothèque numérique SM disponible sur http://localhost:${port}`));
process.on('SIGINT',()=>{db.close();server.close(()=>process.exit(0))});

