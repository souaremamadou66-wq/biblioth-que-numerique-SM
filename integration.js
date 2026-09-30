/* Connects the library interface to the Node.js service when served over HTTP. */
(() => {
  if (location.protocol === 'file:') return;
  const api = async (url, options={}) => {
    const response = await fetch(url, {credentials:'same-origin', ...options,
      headers:{'Content-Type':'application/json', ...(options.headers||{})}});
    let data={}; try { data=await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error||'Une erreur est survenue.');
    return data;
  };
  let currentUser=null, serverMode=true, favoriteIds=[];
  $('[for="importCatalog"]').hidden=true;$('#importCatalog').disabled=true;
  const tell=message=>showToast(message);
  const formBody=(form)=>Object.fromEntries(new FormData(form).entries());
  const refreshBooks=async()=>{const data=await api('/api/books');books=data.books;renderAll()};
  const setupAccount=()=>{
    const card=document.querySelector('.account-page');
    card.insertAdjacentHTML('afterbegin','<label for="fullName" id="nameLabel" hidden>Nom et prénom</label><input id="fullName" autocomplete="name" maxlength="100" placeholder="Votre nom complet" hidden>');
    card.insertAdjacentHTML('beforeend','<button class="secondary" id="registerButton" type="button" style="width:100%;margin:9px 0 0">Créer un compte lecteur</button><button class="secondary" id="logoutButton" type="button" hidden style="width:100%;margin:9px 0 0">Se déconnecter</button><p class="hint">Les comptes et emprunts sont enregistrés sur le serveur de la bibliothèque.</p>');
    document.querySelector('#loginButton').textContent='Se connecter';
    document.querySelector('#loginButton').addEventListener('click',async()=>{
      try {const data=await api('/api/login',{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});currentUser=data.user;updateAccount();if(currentUser.role==='admin')location.hash='admin';else location.hash='myLibrary';tell('Connexion réussie.');}
      catch(e){tell(e.message)}
    });
    $('#registerButton').addEventListener('click',async()=>{
      const fullName=$('#fullName');if(fullName.hidden){fullName.hidden=false;$('#nameLabel').hidden=false;$('#registerButton').textContent='Valider la création du compte';$('#loginButton').hidden=true;return}
      try{const data=await api('/api/register',{method:'POST',body:JSON.stringify({name:fullName.value,email:$('#email').value,password:$('#password').value})});currentUser=data.user;updateAccount();location.hash='myLibrary';tell('Compte créé. Bienvenue à la bibliothèque !')}
      catch(e){tell(e.message)}
    });
    $('#logoutButton').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});currentUser=null;updateAccount();location.hash='accueil';tell('Vous êtes déconnecté.')}catch(e){tell(e.message)}});
    $('#loginButton').addEventListener('click',e=>{if(currentUser){e.stopImmediatePropagation();location.hash=currentUser.role==='admin'?'admin':'myLibrary'}},true);
  };
  function updateAccount(){
    $('#loginButton').hidden=!!currentUser||!$('#fullName').hidden;
    $('#registerButton').hidden=!!currentUser;
    $('#nameLabel').hidden=!!currentUser||$('#fullName').hidden;
    $('#fullName').hidden=!!currentUser||$('#fullName').hidden;
    $('#logoutButton').hidden=!currentUser;
    if(currentUser)$('#accountButton').textContent=currentUser.role==='admin'?'Administration':'Mon espace';
    else $('#accountButton').textContent='Mon espace';
  }
  function serverReaderScreen(book){
    $('#readerTitle').textContent=book.title;
    const paper=$('#readerPaper');paper.innerHTML='<div class="section-kicker">Lecture en ligne</div><h1 style="font:38px var(--serif);margin:8px 0 25px"></h1><div class="reader-text"></div>';
    paper.querySelector('h1').textContent=book.title;
    const text=book.content?.trim();
    if(!text){paper.querySelector('.reader-text').innerHTML='<p>Le fichier de lecture de ce livre n’a pas encore été ajouté par la bibliothèque.</p>';return}
    paper.querySelector('.reader-text').innerHTML=text.split(/\n\s*\n/).map(p=>'<p>'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');
  }
  async function serverAdmin(){
    const [booksData,loanData]=await Promise.all([api('/api/admin/books'),api('/api/admin/loans')]);
    const all=booksData.books,loans=loanData.loans;
    $('#metricBooks').textContent=all.length;$('#metricLoans').textContent=loans.length;
    $('#metricAvailable').textContent=all.filter(b=>b.available&& !loans.some(l=>l.title===b.title)).length;
    $('#adminRows').innerHTML=all.map(b=>`<tr><td>${esc(b.title)}</td><td>${esc(b.author)}</td><td>${esc(b.genre)}</td><td>${b.available?'En ligne':'Archivé'}</td><td><button class="row-action" data-server-edit="${b.id}">Modifier</button><button class="row-action danger" data-server-delete="${b.id}">Retirer</button></td></tr>`).join('');
  }
  async function serverLibrary(){
    if(!currentUser){$('#borrowList').innerHTML='<div class="empty-state">Connectez-vous pour consulter votre bibliothèque.</div>';return}
    try{const [loanData,favData]=await Promise.all([api('/api/loans'),api('/api/favorites')]);favoriteIds=favData.ids;const loans=loanData.loans;
      $('#borrowList').innerHTML=loans.length?loans.map(l=>{const due=new Date(l.due_at).toLocaleDateString('fr-FR');return `<article class="borrow-item"><div class="mini-cover" style="background:${l.color}"></div><div><h3>${esc(l.title)}</h3><p>${esc(l.author)} · À rendre le ${due}</p></div><button data-server-read="${l.book_id}">Continuer la lecture</button><button data-server-renew="${l.id}">Renouveler</button><button data-server-return="${l.id}">Rendre</button></article>`}).join(''):'<div class="empty-state">Votre bibliothèque est encore vide. Parcourez le catalogue pour choisir votre première lecture.</div>';
    }catch(e){tell(e.message);$('#borrowList').innerHTML='<div class="empty-state">Impossible de charger votre bibliothèque.</div>'}
  }
  const oldRenderAll=renderAll;
  renderAll=()=>{oldRenderAll();if(serverMode){renderFeatured();renderCatalogue();renderAdmin();}};
  renderLibrary=()=>{void serverLibrary()};
  const oldShowPage=showPage;
  showPage=(page)=>{oldShowPage(page);if(page==='admin'&&currentUser?.role!=='admin'){tell('Connectez-vous au compte gestionnaire pour accéder à l’administration.');oldShowPage('account');return}if(page==='admin')void serverAdmin();if(page==='myLibrary')void serverLibrary()};
  showBookForm=(book=null)=>{
    const editing=!!book;
    $('#modalBody').innerHTML=`<h2 id="modalTitle" style="font:28px var(--serif);margin:0 0 8px">${editing?'Modifier le livre':'Ajouter un livre'}</h2><p class="section-sub">Les champs marqués * sont obligatoires.</p><form id="serverBookForm"><div class="form-grid"><div><label>Titre *</label><input name="title" required maxlength="180" value="${esc(book?.title||'')}"></div><div><label>Auteur *</label><input name="author" required maxlength="120" value="${esc(book?.author||'')}"></div><div><label>Genre</label><input name="genre" value="${esc(book?.genre||'Romans')}"></div><div><label>Année</label><input name="year" type="number" min="1000" max="2100" value="${book?.year||2026}"></div><div class="wide"><label>Résumé</label><textarea name="description" maxlength="3000">${esc(book?.description||'')}</textarea></div><div class="wide"><label>Texte intégral autorisé à la lecture en ligne</label><textarea name="content" maxlength="1500000" style="min-height:180px" placeholder="Collez ou saisissez le contenu uniquement si vous disposez des droits de diffusion.">${esc(book?.content||'')}</textarea></div><div class="wide"><label>Couleur de couverture</label><input name="color" value="${esc(book?.color||'linear-gradient(145deg,#b57743,#78462e)')}"></div></div><p class="admin-notice">Ajoutez uniquement des livres que vous êtes autorisé à diffuser en version numérique. Le stockage des fichiers ePub/PDF sera ajouté lors de la mise en ligne.</p><div class="form-actions"><button class="primary" type="submit">${editing?'Enregistrer':'Ajouter le livre'}</button><button class="secondary" type="button" id="serverCancel">Annuler</button></div></form>`;
    $('#modalBackdrop').classList.add('open');$('#serverCancel').addEventListener('click',()=>$('#modalBackdrop').classList.remove('open'));
    $('#serverBookForm').addEventListener('submit',async e=>{e.preventDefault();try{const data=formBody(e.currentTarget);data.year=Number(data.year)||2026;await api(editing?`/api/admin/books/${book.id}`:'/api/admin/books',{method:editing?'PUT':'POST',body:JSON.stringify(data)});$('#modalBackdrop').classList.remove('open');await refreshBooks();await serverAdmin();tell(editing?'Livre modifié.':'Livre ajouté au catalogue.')}catch(err){tell(err.message)}});
  };
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='loginButton'){e.preventDefault();e.stopImmediatePropagation();try{const data=await api('/api/login',{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});currentUser=data.user;updateAccount();location.hash=currentUser.role==='admin'?'admin':'myLibrary';tell('Connexion réussie.')}catch(err){tell(err.message)}return}
    if(b.id==='borrowAction'){e.preventDefault();e.stopImmediatePropagation();if(!currentUser){$('#modalBackdrop').classList.remove('open');location.hash='account';tell('Connectez-vous ou créez un compte pour emprunter.');return}const bookId=Number($('#modalBody [data-book-id]')?.dataset.bookId);if(!bookId){const title=$('#modalTitle')?.textContent;const match=books.find(x=>x.title===title);if(!match)return;try{await api('/api/loans',{method:'POST',body:JSON.stringify({bookId:match.id})});$('#modalBackdrop').classList.remove('open');await refreshBooks();tell('Emprunt enregistré pour 14 jours.')}catch(err){tell(err.message)}}return}
    if(b.dataset.serverEdit){e.preventDefault();try{const data=await api('/api/admin/books');showBookForm(data.books.find(x=>x.id===Number(b.dataset.serverEdit)))}catch(err){tell(err.message)}return}
    if(b.dataset.serverDelete){e.preventDefault();const id=Number(b.dataset.serverDelete);if(!confirm('Retirer ce livre du catalogue ?'))return;try{await api(`/api/admin/books/${id}`,{method:'DELETE'});await refreshBooks();await serverAdmin();tell('Livre retiré.')}catch(err){tell(err.message)}return}
    if(b.dataset.serverRead){e.preventDefault();try{const {book}=await api(`/api/books/${b.dataset.serverRead}/read`);serverReaderScreen(book);location.hash='reader'}catch(err){tell(err.message)}return}
    if(b.dataset.serverReturn||b.dataset.serverRenew){e.preventDefault();try{const action=b.dataset.serverReturn?'return':'renew';await api(`/api/loans/${b.dataset.serverReturn||b.dataset.serverRenew}/${action}`,{method:'POST',body:'{}'});await refreshBooks();await serverLibrary();tell(action==='return'?'Livre rendu.':'Emprunt renouvelé pour 7 jours.')}catch(err){tell(err.message)}return}
    if(b.id==='favoriteAction'){e.preventDefault();e.stopImmediatePropagation();if(!currentUser){tell('Connectez-vous pour enregistrer vos favoris.');return}const title=$('#modalTitle')?.textContent,book=books.find(x=>x.title===title);if(!book)return;try{const result=await api('/api/favorites',{method:'POST',body:JSON.stringify({bookId:book.id})});favoriteIds=result.favorite?[...favoriteIds,book.id]:favoriteIds.filter(id=>id!==book.id);b.textContent=result.favorite?'♥ Favori ajouté':'♡ Favori';tell(result.favorite?'Ajouté à vos favoris.':'Retiré des favoris.')}catch(err){tell(err.message)}}
  },true);
  document.addEventListener('submit',e=>{if(e.target.id==='bookForm'){e.preventDefault();e.stopImmediatePropagation()}},true);
  setupAccount();
  (async()=>{try{const [bookData,me]=await Promise.all([api('/api/books'),api('/api/me')]);books=bookData.books;currentUser=me.user;favoriteIds=currentUser?(await api('/api/favorites')).ids:[];updateAccount();renderAll();if(location.hash==='#admin')showPage(currentUser?.role==='admin'?'admin':'account')}catch(e){serverMode=false;tell('Le serveur ne répond pas. Relancez le service local.')}})();
})();

