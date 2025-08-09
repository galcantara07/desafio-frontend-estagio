/* app.js
   Funcionalidades principais implementadas:
   - CEP -> ViaCEP preenchimento
   - Produtos dinâmicos (add/remove) com cálculo Valor Total (qtd * valor unit)
   - Anexos armazenados em sessionStorage (base64) e em memória
   - Validações e modal de salvar com JSON montado e opção de baixar
*/

(function(){
  // Selectors
  const cepEl = document.getElementById('cep');
  const enderecoEl = document.getElementById('endereco');
  const bairroEl = document.getElementById('bairro');
  const municipioEl = document.getElementById('municipio');
  const estadoEl = document.getElementById('estado');

  const productsContainer = document.getElementById('productsContainer');
  const addProductBtn = document.getElementById('addProduct');
  const includeAttachmentBtn = document.getElementById('includeAttachment');
  const fileInput = document.getElementById('fileInput');
  const attachmentsList = document.getElementById('attachmentsList');

  const saveSupplierBtn = document.getElementById('saveSupplier');
  const modal = document.getElementById('modal');
  const jsonOutput = document.getElementById('jsonOutput');
  const modalActions = document.getElementById('modalActions');
  const downloadJsonBtn = document.getElementById('downloadJson');
  const closeModalBtn = document.getElementById('closeModal');

  const FORM_KEY_ATTACHMENTS = 'supplier_attachments_v1'; // sessionStorage key

  // In-memory attachment store (array of {id,name,type,base64})
  let attachments = loadAttachmentsFromSession();

  // PRODUCTS MANAGEMENT
  let productCounter = 0;

  function createProductElement(data = {}) {
    productCounter++;
    const id = `product-${productCounter}`;

    const wrapper = document.createElement('div');
    wrapper.className = 'product';
    wrapper.dataset.id = id;

    wrapper.innerHTML = `
      <button type="button" class="remove" title="Remover produto">🗑</button>
      <div class="row">
        <label class="field" style="flex:1">
          <span>Produto *</span>
          <input type="text" class="prod-desc" placeholder="Descrição" required value="${escapeHtml(data.description || '')}">
        </label>
      </div>

      <div class="row">
        <label class="field small">
          <span>UND. Medida *</span>
          <select class="prod-unit" required>
            <option value="">Selecione</option>
            <option value="un">un</option>
            <option value="kg">kg</option>
            <option value="m">m</option>
            <option value="cx">cx</option>
          </select>
        </label>

        <label class="field small">
          <span>QTD. em Estoque *</span>
          <input type="number" step="1" min="0" class="prod-qty" required value="${data.qty || ''}">
        </label>

        <label class="field small">
          <span>Valor Unitário *</span>
          <input type="number" step="0.01" min="0" class="prod-unitprice" required value="${data.unitPrice || ''}">
        </label>

        <label class="field small">
          <span>Valor Total</span>
          <input type="text" class="prod-total" readonly value="${data.total || ''}">
        </label>
      </div>
    `;

    // set unit select if provided
    if (data.unit) {
      const sel = wrapper.querySelector('.prod-unit');
      sel.value = data.unit;
    }

    // events
    wrapper.querySelector('.remove').addEventListener('click', () => {
      wrapper.remove();
    });

    const qtyEl = wrapper.querySelector('.prod-qty');
    const priceEl = wrapper.querySelector('.prod-unitprice');
    function recalc(){
      const q = parseFloat(qtyEl.value) || 0;
      const p = parseFloat(priceEl.value) || 0;
      const tot = (q * p).toFixed(2);
      wrapper.querySelector('.prod-total').value = tot;
    }
    qtyEl.addEventListener('input', recalc);
    priceEl.addEventListener('input', recalc);

    productsContainer.appendChild(wrapper);
    return wrapper;
  }

  // Start with one product by default
  function ensureAtLeastOneProduct() {
    if (productsContainer.children.length === 0) {
      createProductElement();
    }
  }
  ensureAtLeastOneProduct();

  addProductBtn.addEventListener('click', () => createProductElement());

  // CEP -> ViaCEP
  cepEl.addEventListener('blur', async () => {
    const raw = cepEl.value.replace(/\D/g,'');
    if (!raw || raw.length !== 8) return;
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      if (!resp.ok) throw new Error('Erro ao consultar CEP');
      const data = await resp.json();
      if (data.erro) {
        alert('CEP não encontrado');
        return;
      }
      enderecoEl.value = `${data.logradouro || ''}`;
      bairroEl.value = data.bairro || '';
      municipioEl.value = data.localidade || '';
      estadoEl.value = data.uf || '';
    } catch (err) {
      console.error(err);
      alert('Não foi possível consultar o CEP (verifique sua conexão).');
    }
  });

  // ATTACHMENTS: load UI
  function loadAttachmentsFromSession(){
    try {
      const raw = sessionStorage.getItem(FORM_KEY_ATTACHMENTS);
      return raw ? JSON.parse(raw) : [];
    } catch(e){
      return [];
    }
  }

  function saveAttachmentsToSession(){
    sessionStorage.setItem(FORM_KEY_ATTACHMENTS, JSON.stringify(attachments));
    renderAttachments();
  }

  function renderAttachments(){
    attachmentsList.innerHTML = '';
    if (attachments.length === 0){
      const li = document.createElement('li');
      li.textContent = 'Nenhum anexo';
      attachmentsList.appendChild(li);
      return;
    }
    attachments.forEach(att => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="icon">📄</div>
        <div style="flex:1">
          <div style="font-weight:600">${att.name}</div>
          <div style="font-size:12px;color:#666">${(att.size/1024).toFixed(1)} KB • ${att.type}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn view">👁</button>
          <button class="btn delete">🗑</button>
        </div>
      `;
      li.querySelector('.view').addEventListener('click', ()=> downloadAttachment(att.id));
      li.querySelector('.delete').addEventListener('click', ()=> {
        if(!confirm('Excluir este anexo?')) return;
        attachments = attachments.filter(x=> x.id !== att.id);
        saveAttachmentsToSession();
      });
      attachmentsList.appendChild(li);
    });
  }
  renderAttachments();

  // Include attachment (file input)
  includeAttachmentBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    // read as base64
    const base64 = await fileToBase64(file);
    const id = generateId();
    attachments.push({
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      base64
    });
    saveAttachmentsToSession();
    fileInput.value = '';
  });

  function fileToBase64(file){
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = ()=> res(reader.result.split(',')[1]); // only base64 part
      reader.onerror = ()=> rej(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function downloadAttachment(id){
    const att = attachments.find(a=>a.id===id);
    if(!att) return alert('Anexo não encontrado');
    const byteString = atob(att.base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], {type: att.type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // SAVE / VALIDAÇÃO / JSON
  saveSupplierBtn.addEventListener('click', async () => {
    // basic front-end validation
    const form = document.getElementById('supplierForm');

    const requiredFields = [
      'razao','cnpj','fantasia','cep','endereco','contato','telefone','email'
    ];
    for (const id of requiredFields){
      const el = document.getElementById(id);
      if(!el) continue;
      if(!el.value.trim()){
        el.focus();
        return alert('Preencha o campo obrigatório: ' + id);
      }
    }

    // products validation
    const productEls = Array.from(productsContainer.querySelectorAll('.product'));
    if (productEls.length === 0){
      return alert('É obrigatório incluir pelo menos 1 produto.');
    }
    const products = [];
    for (const pEl of productEls){
      const desc = pEl.querySelector('.prod-desc').value.trim();
      const unit = pEl.querySelector('.prod-unit').value;
      const qty = pEl.querySelector('.prod-qty').value;
      const unitPrice = pEl.querySelector('.prod-unitprice').value;
      const total = pEl.querySelector('.prod-total').value;

      if(!desc || !unit || qty === '' || unitPrice === ''){
        return alert('Preencha todos os campos dos produtos (descrição, unidade, quantidade, valor unitário).');
      }
      products.push({
        description: desc,
        unit,
        qty: Number(qty),
        unitPrice: Number(unitPrice),
        total: Number(total)
      });
    }

    // attachments validation
    if (attachments.length === 0){
      return alert('É obrigatório incluir pelo menos 1 documento em Anexos.');
    }

    // build JSON
    const payload = {
      supplier: {
        razao: document.getElementById('razao').value,
        nomeFantasia: document.getElementById('fantasia').value,
        cnpj: document.getElementById('cnpj').value,
        inscricaoEstadual: document.getElementById('inscEst').value,
        inscricaoMunicipal: document.getElementById('inscMun').value,
        endereco: {
          cep: document.getElementById('cep').value,
          logradouro: enderecoEl.value,
          numero: document.getElementById('numero').value,
          complemento: document.getElementById('complemento').value,
          bairro: bairroEl.value,
          municipio: municipioEl.value,
          estado: estadoEl.value
        },
        contato: {
          nome: document.getElementById('contato').value,
          telefone: document.getElementById('telefone').value,
          email: document.getElementById('email').value
        }
      },
      products,
      attachments: attachments.map(a=>({
        id: a.id,
        name: a.name,
        type: a.type,
        size: a.size,
        base64: a.base64 // já em base64 para envio
      })),
      meta: {
        createdAt: new Date().toISOString()
      }
    };

    // show modal and simulate upload
    showModal();
    // small timeout to simulate processing
    await new Promise(res => setTimeout(res, 1000));
    // display JSON in modal and console
    jsonOutput.textContent = JSON.stringify(payload, null, 2);
    jsonOutput.hidden = false;
    modalActions.hidden = false;
    console.log('JSON a ser enviado:', payload);

    // allow download
    downloadJsonBtn.onclick = () => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fornecedor_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    closeModalBtn.onclick = hideModal;
  });

  function showModal(){
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
    jsonOutput.hidden = true;
    modalActions.hidden = true;
  }
  function hideModal(){
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
  }

  // Utilities
  function generateId(){
    return 'id-' + Math.random().toString(36).slice(2,9);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(m){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
    });
  }

  // initial helpers
  ensureAtLeastOneProduct();
  renderAttachments();

  // expose for debug (optional)
  window.__supplierApp = {
    attachments, saveAttachmentsToSession, createProductElement
  };

})();
