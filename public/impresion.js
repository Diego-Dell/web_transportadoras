(() => {
  const nombreInput = document.getElementById('nombreInput');
  const telefonoInput = document.getElementById('telefonoInput');
  const ciudadInput = document.getElementById('ciudadInput');
  const previewName = document.getElementById('previewName');
  const previewPhone = document.getElementById('previewPhone');
  const previewCity = document.getElementById('previewCity');
  const labelCanvas = document.getElementById('labelCanvas');
  const templateImage = document.getElementById('templateImage');
  const summaryName = document.getElementById('summaryName');
  const summaryPhone = document.getElementById('summaryPhone');
  const summaryCity = document.getElementById('summaryCity');
  const shareHelp = document.getElementById('shareHelp');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');

  const upper = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const digits = value => String(value || '').replace(/\D/g, '').replace(/^591/, '');

  function splitName(value) {
    const name = upper(value) || 'NOMBRE DEL CLIENTE';
    if (name.length <= 21) return name;

    const words = name.split(' ');
    if (words.length < 2) return name;

    let bestIndex = 1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 1; i < words.length; i += 1) {
      const first = words.slice(0, i).join(' ');
      const second = words.slice(i).join(' ');
      const longest = Math.max(first.length, second.length);
      const balance = Math.abs(first.length - second.length);
      const score = longest * 2 + balance;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return `${words.slice(0, bestIndex).join(' ')}\n${words.slice(bestIndex).join(' ')}`;
  }

  function fitText(element, startSize, minimumSize, step = 1) {
    let size = startSize;
    element.style.fontSize = `${size}px`;
    while (
      size > minimumSize &&
      (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
    ) {
      size -= step;
      element.style.fontSize = `${size}px`;
    }
  }

  function resizeTypography() {
    const width = labelCanvas.getBoundingClientRect().width;
    if (!width) return;

    const nameText = previewName.textContent || '';
    const nameLines = nameText.includes('\n') ? 2 : 1;
    fitText(previewName, width * (nameLines === 2 ? 0.054 : 0.060), width * 0.032, 0.5);

    const phoneLength = digits(telefonoInput.value).length || 8;
    fitText(previewPhone, width * (phoneLength > 10 ? 0.046 : 0.052), width * 0.034, 0.5);

    const cityLength = upper(ciudadInput.value).length || 6;
    const cityStart = cityLength > 18 ? width * 0.052 : cityLength > 11 ? width * 0.061 : width * 0.071;
    fitText(previewCity, cityStart, width * 0.037, 0.5);
  }

  function updatePreview() {
    const name = upper(nombreInput.value);
    const phone = digits(telefonoInput.value);
    const city = upper(ciudadInput.value);

    previewName.textContent = splitName(name);
    previewPhone.textContent = phone || '70000000';
    previewCity.textContent = city || 'CIUDAD';

    summaryName.textContent = name || 'Sin completar';
    summaryPhone.textContent = phone ? `+591 ${phone}` : 'Sin completar';
    summaryCity.textContent = city || 'Sin completar';

    requestAnimationFrame(resizeTypography);
  }

  function loadFromQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('nombre')) nombreInput.value = params.get('nombre') || '';
    if (params.has('telefono')) telefonoInput.value = digits(params.get('telefono'));
    if (params.has('ciudad')) ciudadInput.value = params.get('ciudad') || '';
  }

  function validate() {
    const missing = [];
    if (!upper(nombreInput.value)) missing.push('nombre');
    if (!digits(telefonoInput.value)) missing.push('teléfono');
    if (!upper(ciudadInput.value)) missing.push('ciudad');
    if (missing.length) {
      alert(`Completa: ${missing.join(', ')}.`);
      return false;
    }
    return true;
  }

  function setLoading(show, text = 'Generando archivo...') {
    loadingText.textContent = text;
    loadingOverlay.classList.toggle('d-none', !show);
  }

  async function waitReady() {
    if (document.fonts?.ready) await document.fonts.ready;
    if (!templateImage.complete) {
      await new Promise((resolve, reject) => {
        templateImage.addEventListener('load', resolve, { once: true });
        templateImage.addEventListener('error', reject, { once: true });
      });
    }
    updatePreview();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function renderCanvas() {
    await waitReady();
    return html2canvas(labelCanvas, {
      scale: 3,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 15000
    });
  }

  function filename(ext) {
    const name = upper(nombreInput.value).replace(/[^A-Z0-9ÁÉÍÓÚÑ]+/g, '-').replace(/^-|-$/g, '') || 'CLIENTE';
    const city = upper(ciudadInput.value).replace(/[^A-Z0-9ÁÉÍÓÚÑ]+/g, '-').replace(/^-|-$/g, '') || 'CIUDAD';
    return `nota-envio-${name}-${city}.${ext}`.toLowerCase();
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function canvasBlob(canvas, type = 'image/png', quality = 1) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  document.getElementById('pdfBtn').addEventListener('click', async () => {
    if (!validate()) return;
    try {
      setLoading(true, 'Generando PDF...');
      const canvas = await renderCanvas();
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
      pdf.save(filename('pdf'));
    } catch (error) {
      console.error(error);
      alert('No se pudo generar el PDF. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  });

  document.getElementById('pngBtn').addEventListener('click', async () => {
    if (!validate()) return;
    try {
      setLoading(true, 'Generando PNG...');
      const canvas = await renderCanvas();
      const blob = await canvasBlob(canvas);
      downloadBlob(blob, filename('png'));
    } catch (error) {
      console.error(error);
      alert('No se pudo generar la imagen.');
    } finally {
      setLoading(false);
    }
  });

  document.getElementById('printBtn').addEventListener('click', async () => {
    if (!validate()) return;
    try {
      setLoading(true, 'Preparando impresión...');
      const canvas = await renderCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      const printWindow = window.open('', '_blank');
      if (!printWindow) throw new Error('Ventana bloqueada');
      printWindow.document.write(`<!doctype html><html><head><title>Imprimir nota</title><style>@page{size:A4 landscape;margin:0}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}img{display:block;width:297mm;height:210mm;object-fit:contain}</style></head><body><img src="${dataUrl}" onload="setTimeout(()=>window.print(),300)"></body></html>`);
      printWindow.document.close();
    } catch (error) {
      console.error(error);
      alert('No se pudo abrir la impresión. Revisa si el navegador bloqueó la ventana emergente.');
    } finally {
      setLoading(false);
    }
  });

  document.getElementById('whatsappBtn').addEventListener('click', async () => {
    if (!validate()) return;
    try {
      setLoading(true, 'Preparando para WhatsApp...');
      const canvas = await renderCanvas();
      const blob = await canvasBlob(canvas);
      const file = new File([blob], filename('png'), { type: 'image/png' });
      const text = `Hola ${upper(nombreInput.value)}, te compartimos tu nota de envío para ${upper(ciudadInput.value)}.`;

      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ title: 'Nota de envío', text, files: [file] });
        shareHelp.classList.add('d-none');
      } else {
        downloadBlob(blob, filename('png'));
        const phone = digits(telefonoInput.value);
        const waUrl = `https://wa.me/591${phone}?text=${encodeURIComponent(`${text}\nLa imagen se descargó en tu dispositivo; adjúntala en este chat.`)}`;
        window.open(waUrl, '_blank', 'noopener');
        shareHelp.textContent = 'La nota se descargó como PNG y se abrió el chat del cliente para adjuntarla.';
        shareHelp.classList.remove('d-none');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error(error);
        alert('No se pudo compartir la nota por WhatsApp.');
      }
    } finally {
      setLoading(false);
    }
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    nombreInput.value = '';
    telefonoInput.value = '';
    ciudadInput.value = '';
    shareHelp.classList.add('d-none');
    updatePreview();
    nombreInput.focus();
  });

  [nombreInput, telefonoInput, ciudadInput].forEach(input => input.addEventListener('input', updatePreview));
  telefonoInput.addEventListener('input', () => { telefonoInput.value = digits(telefonoInput.value); });
  new ResizeObserver(resizeTypography).observe(labelCanvas);
  window.addEventListener('load', () => {
    loadFromQuery();
    updatePreview();
  });
})();
