
// ===================================
// USER EVENT VIEW (for regular users)
// ===================================

async function loadMyEventInfo(authHeaders) {
  try {
    const res = await fetch('/api/portal/eventos/my-registration', {
      headers: authHeaders
    });
    const data = await res.json();

    if (!data.ok) {
      console.error('Error loading event info:', data.error);
      renderNotEnrolledView();
      return;
    }

    if (!data.enrolled) {
      renderNotEnrolledView();
      return;
    }

    // Render sections
    renderCountdown();
    renderPaymentStatus(data);
    renderMyGroup(data.group);
    renderWhatsAppButton();
    renderPolicies();

  } catch (err) {
    console.error('Error in loadMyEventInfo:', err);
    renderNotEnrolledView();
  }
}

function renderCountdown() {
  const countdownEl = document.getElementById('event-countdown');
  if (!countdownEl) return;

  const eventDate = new Date('2026-06-06T00:00:00');

  function updateCountdown() {
    const now = new Date();
    const diff = eventDate - now;

    if (diff <= 0) {
      countdownEl.innerHTML = `
        <div class="text-center py-8">
          <h3 class="text-2xl font-bold text-brand-teal">¡La Cumbre ha comenzado!</h3>
        </div>
      `;
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    countdownEl.innerHTML = `
      <div class="bg-gradient-to-br from-[#293C74] to-[#1e2b58] rounded-[3rem] p-10 text-white text-center">
        <h2 class="text-3xl font-bold mb-2">Cumbre Mundial 2026</h2>
        <p class="text-brand-teal mb-8">La Unión, Valle del Cauca • Junio 6-8, 2026</p>
        
        <div class="grid grid-cols-4 gap-4 max-w-lg mx-auto">
          <div class="bg-white/10 backdrop-blur rounded-2xl p-4">
            <div class="text-4xl font-bold text-brand-teal">${days}</div>
            <div class="text-xs text-white/60 uppercase mt-1">Días</div>
          </div>
          <div class="bg-white/10 backdrop-blur rounded-2xl p-4">
            <div class="text-4xl font-bold text-brand-teal">${hours}</div>
            <div class="text-xs text-white/60 uppercase mt-1">Horas</div>
          </div>
          <div class="bg-white/10 backdrop-blur rounded-2xl p-4">
            <div class="text-4xl font-bold text-brand-teal">${minutes}</div>
            <div class="text-xs text-white/60 uppercase mt-1">Min</div>
          </div>
          <div class="bg-white/10 backdrop-blur rounded-2xl p-4">
            <div class="text-4xl font-bold text-brand-teal">${seconds}</div>
            <div class="text-xs text-white/60 uppercase mt-1">Seg</div>
          </div>
        </div>
      </div>
    `;
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
}

function renderPaymentStatus(data) {
  const statusEl = document.getElementById('my-payment-status');
  if (!statusEl) return;

  const { payment, installments } = data;
  const isPaidFull = payment.isPaidFull;

  if (isPaidFull) {
    // Paid in full - Green success card
    statusEl.innerHTML = `
      <div class="bg-gradient-to-br from-green-50 to-emerald-50 rounded-[3rem] p-8 border border-green-200">
        <div class="flex items-start gap-4 mb-6">
          <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div class="flex-1">
            <h3 class="text-2xl font-bold text-green-900">¡Inscripción Confirmada!</h3>
            <p class="text-green-700 mt-1">Pago completo • ${data.group.memberCount} persona${data.group.memberCount > 1 ? 's' : ''}</p>
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-white/80 rounded-2xl p-5">
            <p class="text-xs text-green-600 font-bold uppercase tracking-wide mb-1">Total Pagado</p>
            <p class="text-3xl font-bold text-green-900">$${payment.totalAmount.toLocaleString()}</p>
          </div>
          <div class="bg-white/80 rounded-2xl p-5">
            <p class="text-xs text-green-600 font-bold uppercase tracking-wide mb-1">Participantes</p>
            <p class="text-3xl font-bold text-green-900">${data.group.memberCount}</p>
          </div>
        </div>
      </div>
    `;
  } else {
    // Has pending payments
    const pendingCount = installments.pendingCount || 0;
    const progress = payment.totalAmount > 0 ? Math.round((payment.totalPaid / payment.totalAmount) * 100) : 0;

    statusEl.innerHTML = `
      <div class="bg-white rounded-[3rem] p-8 border border-slate-200">
        <div class="flex items-start justify-between mb-6">
          <div>
            <h3 class="text-2xl font-bold text-[#293C74]">Plan de Pagos</h3>
            <p class="text-slate-500 text-sm mt-1">${data.group.memberCount} persona${data.group.memberCount > 1 ? 's' : ''} inscrita${data.group.memberCount > 1 ? 's' : ''}</p>
          </div>
          <span class="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-full text-xs font-bold">
            ${pendingCount} cuota${pendingCount !== 1 ? 's' : ''} pendiente${pendingCount !== 1 ? 's' : ''}
          </span>
        </div>
        
        <!-- Progress Bar -->
        <div class="mb-6">
          <div class="flex justify-between text-sm mb-2">
            <span class="text-slate-600">$${payment.totalPaid.toLocaleString()} de $${payment.totalAmount.toLocaleString()}</span>
            <span class="text-[#293C74] font-bold">${progress}%</span>
          </div>
          <div class="w-full bg-slate-100 rounded-full h-3">
            <div class="bg-gradient-to-r from-brand-teal to-[#4CC9E0] h-3 rounded-full transition-all" style="width: ${progress}%"></div>
          </div>
        </div>
        
        <!-- Installments -->
        <div class="space-y-3" id="installments-list">
          ${renderInstallmentsList(installments.all, payment.totalPaid)}
        </div>
      </div>
    `;
  }
}

function renderInstallmentsList(installments, totalPaid) {
  if (!installments || installments.length === 0) {
    return `<p class="text-slate-400 text-sm text-center py-4">No hay cuotas programadas</p>`;
  }

  return installments.map((inst, index) => {
    const isPaid = inst.status === 'PAID';
    const dueDate = new Date(inst.due_date);
    const formattedDate = dueDate.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

    if (isPaid) {
      return `
        <div class="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-2xl">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p class="font-bold text-green-900">Cuota ${inst.installment_number}</p>
              <p class="text-xs text-green-600">Pagado</p>
            </div>
          </div>
          <span class="text-green-700 font-bold">$${inst.amount.toLocaleString()}</span>
        </div>
      `;
    } else {
      const isOverdue = new Date() > dueDate;
      return `
        <div class="flex items-center justify-between p-4 ${isOverdue ? 'bg-red-50 border-red-200 border-2' : 'bg-yellow-50 border border-yellow-200'} rounded-2xl">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 ${isOverdue ? 'bg-red-500' : 'bg-yellow-500'} rounded-full flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p class="font-bold ${isOverdue ? 'text-red-900' : 'text-yellow-900'}">Cuota ${inst.installment_number}</p>
              <p class="text-xs ${isOverdue ? 'text-red-600' : 'text-yellow-600'}">${isOverdue ? 'Vencida' : 'Vence'}: ${formattedDate}</p>
            </div>
          </div>
          <span class="${isOverdue ? 'text-red-700' : 'text-yellow-700'} font-bold">$${inst.amount.toLocaleString()}</span>
        </div>
      `;
    }
  }).join('');
}

function renderMyGroup(group) {
  const groupEl = document.getElementById('my-group-members');
  if (!groupEl) return;

  if (!group || !group.members || group.members.length === 0) {
    groupEl.innerHTML = '<p class="text-slate-400 text-center py-8">No hay participantes</p>';
    return;
  }

  groupEl.innerHTML = `
    <div class="bg-white rounded-[3rem] p-8 border border-slate-200">
      <h3 class="text-lg font-bold text-[#293C74] mb-6">Participantes Inscritos</h3>
      
      <div class="space-y-3">
        ${group.members.map(member => {
    const initials = member.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    const isLeader = member.is_leader;

    return `
            <div class="flex items-center gap-4 p-4 ${isLeader ? 'bg-[#293C74]/5' : 'bg-slate-50'} rounded-2xl">
              <div class="w-12 h-12 ${isLeader ? 'bg-[#293C74]' : 'bg-slate-300'} rounded-full flex items-center justify-center ${isLeader ? 'text-white' : 'text-slate-600'} font-bold text-sm">
                ${initials}
              </div>
              <div class="flex-1">
                <p class="font-bold ${isLeader ? 'text-[#293C74]' : 'text-slate-700'}">${member.name}</p>
                <p class="text-xs text-slate-500">
                  ${member.age ? member.age + ' años • ' : ''}${member.package_type === 'lodging' ? 'Con alojamiento' : 'Sin alojamiento'}
                </p>
              </div>
              ${isLeader ? '<span class="px-3 py-1 bg-brand-teal/10 text-brand-teal text-xs font-bold rounded-full">Líder</span>' : ''}
            </div>
          `;
  }).join('')}
      </div>
    </div>
  `;
}

function renderWhatsAppButton() {
  const whatsappEl = document.getElementById('event-whatsapp');
  if (!whatsappEl) return;

  const message = encodeURIComponent('Hola, necesito información sobre la Cumbre Mundial 2026');
  const whatsappNumber = '573001234567'; // TODO: Replace with actual number

  whatsappEl.innerHTML = `
    <div class="bg-gradient-to-br from-[#25D366] to-[#1ea952] rounded-[3rem] p-8 text-white text-center">
      <div class="w-16 h-16 bg-white/20 rounded-full mx-auto mb-4 flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </div>
      <h3 class="text-xl font-bold mb-2">¿Necesitas ayuda?</h3>
      <p class="text-white/80 text-sm mb-6">
        Contacta con nuestro equipo por WhatsApp para información sobre ubicación, hospedaje o preguntas generales
      </p>
      <a href="https://wa.me/${whatsappNumber}?text=${message}" 
         target="_blank"
         class="inline-flex items-center gap-2 bg-white text-green-600 px-8 py-4 rounded-xl font-bold shadow-lg hover:shadow-xl transition-all hover:scale-105">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        Abrir WhatsApp
      </a>
    </div>
  `;
}

function renderNotEnrolledView() {
  const statusEl = document.getElementById('my-payment-status');
  if (!statusEl) return;

  statusEl.innerHTML = `
    <div class="space-y-6">
      <!-- Promo Card -->
      <div class="bg-gradient-to-br from-[#293C74] to-[#1e2b58] rounded-[3rem] p-10 text-white text-center shadow-2xl">
        <div class="w-20 h-20 bg-brand-teal/20 rounded-full mx-auto mb-6 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-brand-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <h3 class="text-3xl font-bold mb-3">¡Aún no estás inscrito!</h3>
        <p class="text-white/80 mb-2 text-lg">Cumbre Mundial 2026</p>
        <p class="text-brand-teal text-xl font-bold mb-6">Junio 6-8 • La Unión, Valle del Cauca</p>
        
        <div class="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-8 text-sm">
          <div class="bg-white/10 backdrop-blur rounded-xl p-4">
            <div class="text-2xl mb-2">🙏</div>
            <div class="font-semibold">3 días de adoración</div>
          </div>
          <div class="bg-white/10 backdrop-blur rounded-xl p-4">
            <div class="text-2xl mb-2">📖</div>
            <div class="font-semibold">Enseñanza bíblica</div>
          </div>
          <div class="bg-white/10 backdrop-blur rounded-xl p-4">
            <div class="text-2xl mb-2">👥</div>
            <div class="font-semibold">Comunidad internacional</div>
          </div>
        </div>
        
        <a href="/eventos/cumbre-mundial-2026/inscripcion" 
           class="inline-flex items-center gap-3 bg-brand-teal hover:bg-[#2dd4bf] text-white px-10 py-5 rounded-2xl font-bold text-lg shadow-2xl shadow-brand-teal/30 hover:scale-105 transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Inscribirme ahora
        </a>
        
        <p class="text-white/50 text-xs mt-6 max-w-lg mx-auto">
          Reserva tu lugar y el de tu familia. Pago completo o en cuotas disponible.
        </p>
      </div>
      
      <!-- Info adicional -->
      <div class="grid md:grid-cols-2 gap-4">
        <div class="bg-white rounded-2xl p-6 border border-slate-100">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h4 class="font-bold text-[#293C74] mb-1">¿Necesitas más información?</h4>
              <p class="text-sm text-slate-600">
                Visita la <a href="/eventos/cumbre-mundial-2026" class="text-brand-teal underline font-semibold">página del evento</a> para conocer todos los detalles.
              </p>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-2xl p-6 border border-slate-100">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div>
              <h4 class="font-bold text-[#293C74] mb-1">Inscripción grupal</h4>
              <p class="text-sm text-slate-600">
                Puedes inscribir a tu familia o grupo completo en un solo proceso.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Still show countdown
  renderCountdown();
  renderWhatsAppButton();
  renderPolicies();
}

function renderPolicies() {
  const policiesEl = document.getElementById('event-policies');
  if (!policiesEl) return;

  policiesEl.innerHTML = `
    <div class="bg-slate-50 rounded-[3rem] p-8 border border-slate-100">
      <div class="flex items-start gap-3 mb-6">
        <div class="w-10 h-10 bg-[#293C74] rounded-full flex items-center justify-center text-white flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-lg font-bold text-[#293C74] mb-2">Políticas y Condiciones</h3>
          <p class="text-sm text-slate-600 mb-4">Información importante para participantes de la Cumbre Mundial 2026</p>
        </div>
      </div>
      
      <div class="space-y-4 text-sm">
        <div class="bg-white rounded-2xl p-5 border border-slate-100">
          <div class="flex items-start gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-teal flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 class="font-bold text-[#293C74] mb-1">Política de Pagos</h4>
              <p class="text-slate-600 leading-relaxed">Los pagos pueden realizarse en efectivo en tu iglesia o mediante transferencia bancaria. Si eliges pago a cuotas, debes cumplir con las fechas de vencimiento establecidas.</p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-2xl p-5 border border-slate-100">
          <div class="flex items-start gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 class="font-bold text-[#293C74] mb-1">Cancelaciones y Reembolsos</h4>
              <p class="text-slate-600 leading-relaxed">Las cancelaciones realizadas antes del 1 de mayo tendrán un reembolso del 50%. Después de esa fecha, no se realizarán reembolsos.</p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-2xl p-5 border border-slate-100">
          <div class="flex items-start gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <div>
              <h4 class="font-bold text-[#293C74] mb-1">Alojamiento</h4>
              <p class="text-slate-600 leading-relaxed">El alojamiento incluye hospedaje del 5 al 8 de junio. Check-in viernes 6 desde las 2:00 PM, check-out domingo 8 a las 12:00 PM.</p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-2xl p-5 border border-slate-100">
          <div class="flex items-start gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <div>
              <h4 class="font-bold text-[#293C74] mb-1">Alimentación</h4>
              <p class="text-slate-600 leading-relaxed">Incluye desayuno, almuerzo y cena durante los 3 días. Informa restricciones alimentarias con 2 semanas de anticipación.</p>
            </div>
          </div>
        </div>

        <div class="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 mt-6">
          <div class="flex items-start gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 class="font-bold text-blue-900 mb-2">Notas Importantes</h4>
              <ul class="text-blue-800 text-xs space-y-1 leading-relaxed list-disc list-inside">
                <li>Trae ropa cómoda y adecuada para clima cálido</li>
                <li>No olvides tu documento de identidad</li>
                <li>El evento es libre de alcohol y cigarrillos</li>
                <li>Respeta los horarios establecidos</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
