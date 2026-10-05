window.AdminQR = {
  people: [],
  async refresh() {
    this.people = await Splash.call('people');
    registeredPeople = this.people.filter(person => person.active).map(person => person.name);
    renderPersonSuggestions();
    this.render(peopleSearch.value);
  },
  render(query = '') {
    const search = query.trim().toLocaleLowerCase();
    peopleList.innerHTML = this.people.filter(p => `${p.name} ${p.dni || ''}`.toLocaleLowerCase().includes(search)).map(p =>
      `<div class="people-item"><div class="people-item-name"><strong>${Splash.escape(p.name)}</strong><small>${Splash.escape(p.dni || 'DNI pendiente')} · ${p.active ? (p.has_pin ? 'PIN creado' : 'Sin PIN') : 'Inactivo'}</small></div><div class="people-item-actions"><button type="button" data-profile="${p.id}">Perfil</button>${p.active ? `<button type="button" data-use-profile="${p.id}">Usar</button>` : ''}<button type="button" class="people-delete" data-delete-person="${p.id}" data-person-name="${Splash.escape(p.name)}">Eliminar</button></div></div>`
    ).join('') || '<p class="people-empty">No hay personas que coincidan.</p>';
  },
  async delete(id, name) {
    const personName = name || 'esta persona';
    if (!window.confirm(`¿Eliminar a «${personName}» de las personas registradas? Se cerrará su acceso. Sus asistencias anteriores se conservarán.`)) return;
    if (this.deleting) return;
    this.deleting = true;
    try {
      await Splash.call('delete_person', { id });
      await this.refresh();
      const profileDlg = document.getElementById('profile-dialog');
      if (profileDlg && profileDlg.open) profileDlg.close();
      showToast(`«${personName}» fue eliminado.`);
    } catch (error) { showToast(error.message || 'No se pudo eliminar a la persona.'); }
    finally { this.deleting = false; }
  },
  async add() {
    const name = buildFullPersonName(personFirstName.value, personLastName.value);
    const dni = document.getElementById('person-dni').value.trim();
    const type = document.getElementById('person-account-type').value;
    personAddButton.disabled = true;
    try {
      await Splash.call('save_person', { name, dni, type });
      await this.refresh();
      personFirstName.value = ''; personLastName.value = ''; document.getElementById('person-dni').value = '';
      showToast('Cuenta registrada. El operario ya puede crear su PIN en la base.');
    } catch (error) { showToast(error.message); }
    finally { personAddButton.disabled = false; }
  },
  profile(id) {
    const p = this.people.find(person => person.id === id);
    if (!p) return;
    const $ = id => document.getElementById(id);
    $('profile-id').value = p.id;
    $('profile-name').value = p.name;
    $('profile-dni').value = p.dni || '';
    $('profile-dni').required = !!p.dni;
    $('profile-dni-help').textContent = p.dni ? 'El DNI registrado debe conservar 8 dígitos.' : 'Si aún no tiene DNI registrado, puedes guardar su perfil sin completarlo.';
    $('profile-type').value = p.type;
    $('profile-active').checked = p.active;
    $('profile-pin').textContent = p.has_pin ? 'PIN creado. Pulsa «Consultar PIN» para verlo.' : 'El operario aún no creó su PIN.';
    $('profile-pin-show').disabled = !p.has_pin;
    $('profile-message').textContent = '';
    $('profile-dialog').showModal();
  }
};

(() => {
  const $ = id => document.getElementById(id);
  window.addEventListener('splash-push-status', event => {
    $('admin-push-status').hidden = false;
    $('admin-push-status').textContent = event.detail;
  });
  const voiceButton = $('admin-voice-settings');
  if (window.SplashAdminNative?.configureVoice) {
    voiceButton.hidden = false;
    voiceButton.addEventListener('click', () => window.SplashAdminNative.configureVoice());
  }
  $('profile-close').addEventListener('click', () => $('profile-dialog').close());
  $('profile-dialog').addEventListener('close', () => { $('profile-pin').textContent = ''; });
  $('profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('profile-save').disabled = true;
    try {
      await Splash.call('save_person', { id: $('profile-id').value, name: $('profile-name').value.trim(), dni: $('profile-dni').value.trim(), type: $('profile-type').value, active: $('profile-active').checked });
      await AdminQR.refresh();
      $('profile-dialog').close();
      showToast('Perfil actualizado.');
    } catch (error) { $('profile-message').textContent = error.message; }
    finally { $('profile-save').disabled = false; }
  });
  $('profile-pin-show').addEventListener('click', async () => {
    try {
      const data = await Splash.call('person_pin', { id: $('profile-id').value });
      $('profile-pin').textContent = data.pin ? `PIN: ${data.pin}` : 'El operario aún no creó su PIN.';
    } catch (error) { $('profile-message').textContent = error.message; }
  });
  peopleList.addEventListener('click', event => {
    const profile = event.target.closest('[data-profile]');
    if (profile) AdminQR.profile(profile.dataset.profile);
    const use = event.target.closest('[data-use-profile]');
    if (use) {
      const p = AdminQR.people.find(person => person.id === use.dataset.useProfile);
      if (!p) return;
      input.value = p.name;
      document.querySelector(`input[name="person-type"][value="${p.type}"]`).checked = true;
      peopleDialog.close(); input.focus();
    }
    const del = event.target.closest('[data-delete-person]');
    if (del) {
      AdminQR.delete(del.dataset.deletePerson, del.dataset.personName);
    }
  });
  $('profile-delete')?.addEventListener('click', () => {
    const id = $('profile-id').value;
    const name = $('profile-name').value;
    if (id) AdminQR.delete(id, name);
  });

  let qrURL = '';
  function drawQR(data) {
    const url = new URL('operarios.html', location.href);
    url.hash = `base=${data.token}`;
    qrURL = url.href;
    $('base-qr').replaceChildren();
    new QRCode($('base-qr'), { text: qrURL, width: 280, height: 280, colorDark: '#102f49', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    $('qr-download').disabled = false;
    $('qr-print').disabled = false;
    $('qr-message').textContent = 'QR vigente. Colócalo en un lugar visible dentro de la base.';
  }
  $('generate-qr-button').addEventListener('click', async () => {
    closeNavigation();
    $('qr-dialog').showModal();
    $('qr-download').disabled = true; $('qr-print').disabled = true;
    $('qr-message').textContent = 'Cargando QR…';
    try {
      if (!qrEnabled) throw new Error('Primero activa la migración QR en Supabase.');
      if (location.protocol !== 'https:' && location.hostname !== 'localhost') throw new Error('Abre la dirección HTTPS publicada para generar un QR accesible desde los teléfonos.');
      drawQR(await Splash.call('qr'));
    } catch (error) { $('qr-message').textContent = error.message; }
  });
  $('qr-close').addEventListener('click', () => $('qr-dialog').close());
  $('qr-rotate').addEventListener('click', async () => {
    if (!qrEnabled || !confirm('¿Reemplazar el QR? El anterior dejará de funcionar y deberás imprimir el nuevo.')) return;
    $('qr-rotate').disabled = true;
    try { drawQR(await Splash.call('rotate_qr')); }
    catch (error) { $('qr-message').textContent = error.message; }
    finally { $('qr-rotate').disabled = false; }
  });
  $('qr-print').addEventListener('click', () => window.print());
  $('qr-download').addEventListener('click', () => {
    const source = $('base-qr').querySelector('canvas');
    if (!source || !qrURL) return;
    // Incluye margen blanco alrededor del QR para que sea legible al imprimir.
    const poster = document.createElement('canvas'); poster.width = 900; poster.height = 1100;
    const ctx = poster.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 1100);
    ctx.fillStyle = '#102f49'; ctx.textAlign = 'center'; ctx.font = 'bold 36px sans-serif';
    ctx.fillText('SPLASH SEDE LAS FLORES', 450, 90);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(source, 130, 190, 640, 640);
    ctx.font = 'bold 32px sans-serif'; ctx.fillText('REGISTRA TU ASISTENCIA', 450, 925);
    ctx.font = '24px sans-serif'; ctx.fillText('Escanea e ingresa con tu DNI y PIN.', 450, 980);
    const link = document.createElement('a'); link.download = 'QR-SPLASH-LAS-FLORES.png'; link.href = poster.toDataURL('image/png'); link.click();
  });
  $('admin-logout').addEventListener('click', async () => {
    if (window.SplashAdminNative?.disableNotifications) window.SplashAdminNative.disableNotifications();
    const revocation = qrEnabled ? Splash.call('logout') : Promise.resolve();
    Splash.clearAdminSession();
    loginScreen.hidden = false;
    try { await revocation; } catch { /* El acceso local ya está cerrado. */ }
    location.reload();
  });
  window.addEventListener('splash-session-expired', event => {
    if (event.detail !== 'admin') return;
    localStorage.removeItem('splash-admin-persist');
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    loginScreen.hidden = false; loginMessage.textContent = 'Tu sesión venció. Vuelve a iniciar sesión.';
  });
  const stopWatching = Splash.watchAttendance(() => { if (qrEnabled && loginScreen.hidden) loadCurrentRecord(false); });
  window.addEventListener('pagehide', stopWatching);
  setInterval(() => { if (qrEnabled && loginScreen.hidden && peopleDialog.open && !$('profile-dialog').open) AdminQR.refresh().catch(error => showToast(error.message)); }, 3000);
  async function restoreAdminSession() {
    const token = Splash.adminSession();
    if (!token) return;
    $('keep-session').checked = !!(localStorage.getItem('splash-admin-session') || localStorage.getItem('splash-admin-persist'));
    // Older APKs read this key directly to register push notifications.
    sessionStorage.setItem('splash-admin-session', token);
    const submit = loginForm.querySelector('[type="submit"]');
    submit.disabled = true;
    loginMessage.textContent = 'Comprobando tu sesión…';
    try {
      await AdminQR.refresh();
      if (Splash.adminSession() !== token) return;
      qrEnabled = true;
      peopleResetButton.hidden = true;
      loginScreen.hidden = true;
      loginMessage.textContent = '';
      if (window.SplashAdminNative?.enableNotifications) window.SplashAdminNative.enableNotifications();
      await loadCurrentRecord(true);
      await renderHistory();
    } catch (error) {
      loginScreen.hidden = false;
      loginMessage.textContent = error.code === 'SESSION' ? 'Tu sesión venció. Vuelve a iniciar sesión.' :
        'No se pudo comprobar tu sesión. Revisa la conexión y vuelve a abrir la app, o inicia sesión.';
    } finally { submit.disabled = false; }
  }
  restoreAdminSession();
})();
