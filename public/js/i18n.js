/* RainLine — idiomas
   O app detecta o idioma do aparelho e abre nele. A escolha manual, feita em
   Configurações, tem prioridade e fica salva. */
(function (global) {
  'use strict';

  var DICT = {
    en: {
      'Usuário': 'Username', 'Senha': 'Password', 'Entrar': 'Sign in',
      'Primeiro acesso:': 'First time:', '— troque em Configurações.': '— change it in Settings.',
      'Bem-vindo': 'Welcome', 'Vendedor': 'Salesperson',
      'Verificando conexão…': 'Checking connection…', 'Sincronizar': 'Sync',
      'Orçamentos no mês': 'Estimates this month', 'Fechado no mês': 'Closed this month',
      'Novo orçamento': 'New estimate',
      'Endereço → medir no satélite → fechar': 'Address → measure on satellite → close',
      'Clientes': 'Customers', 'Histórico': 'History', 'Configurações': 'Settings',
      'Passo 1 de 4': 'Step 1 of 4', 'Passo 2 de 4': 'Step 2 of 4',
      'Passo 3 de 4': 'Step 3 of 4', 'Passo 4 de 4': 'Step 4 of 4',
      'Cliente': 'Customer', 'Nome do cliente': 'Customer name', 'Telefone': 'Phone',
      'Endereço': 'Address', 'Cidade': 'City', 'Estado': 'State',
      'Observações': 'Notes', 'Buscar imóvel': 'Find property',
      'Medir calhas': 'Measure gutters', 'Desenhar': 'Draw', 'Ajustar': 'Adjust',
      'Ampliar casa': 'Zoom house', 'Medições': 'Measurements', 'Desfazer': 'Undo',
      'Nova linha': 'New line', 'Medir na foto': 'Measure on photo',
      'Contorno OSM': 'OSM outline', 'Ver em 3D': 'View in 3D',
      'Realçar': 'Enhance', 'Limpar': 'Clear', 'Toque numa linha': 'Tap a line',
      'Continuar': 'Continue', 'Térreo': 'Ground', 'Apagar linha': 'Delete line',
      'linhas': 'lines', 'cantos': 'corners', 'Calcular materiais': 'Calculate materials',
      'Satélite ampliado': 'Zoomed satellite', 'Traçar calhas': 'Trace gutters',
      'toque nos cantos do beiral': 'tap the eave corners',
      'Tela cheia': 'Full screen', 'Ângulo 90°': 'Lock 90°', 'Fechar volta': 'Close loop',
      'medido no satélite': 'measured on satellite', 'Concluir': 'Done',
      'Resumo': 'Summary', 'LINEAR FEET NO TOTAL': 'TOTAL LINEAR FEET',
      'Medido no satélite': 'Measured on satellite', 'Lados cobertos': 'Sides covered',
      'Medido em foto': 'Measured on photo', 'fachadas e partes escondidas': 'facades and hidden parts',
      'Anexar foto e medir': 'Attach photo and measure', 'Voltar ao mapa': 'Back to map',
      'Fachada': 'Facade', 'Medir na foto ': 'Measure on photo',
      'Referência': 'Reference', 'Beirais': 'Eaves', 'Descidas': 'Downspouts',
      'Detectar linhas': 'Detect lines', 'Alinhar': 'Align', 'Encaixar': 'Snap',
      'Bordas': 'Edges', 'Só horizontais': 'Horizontal only',
      'Garagem dupla 16\'': 'Double garage 16\'', 'Garagem simples 9\'': 'Single garage 9\'',
      'Porta 3\'': 'Door 3\'', 'Janela simples · larg 3\'': 'Single window · 3\' wide',
      'Janela dupla · larg 6\'': 'Double window · 6\' wide', 'Janela · altura 5\'': 'Window · 5\' tall',
      'Régua da imagem': 'Image scale bar', 'Referência de escala:': 'Scale reference:',
      'Somar ao orçamento': 'Add to estimate', 'Lado da casa:': 'House side:',
      'Casa inteira': 'Whole house', 'Frente': 'Front', 'Direita': 'Right',
      'Fundo': 'Back', 'Esquerda': 'Left', 'Nova foto': 'New photo', 'Galeria': 'Gallery',
      'Escolher imagem': 'Choose image', 'Tirar foto agora': 'Take photo now',
      'Escolher da galeria': 'Choose from gallery',
      'Materiais': 'Materials', 'Pavimentos': 'Stories', 'Cor / acabamento': 'Color / finish',
      '1 andar': '1 story', '2 andares': '2 stories', '3 andares': '3 stories',
      'Medido:': 'Measured:', 'Lista de material': 'Material list',
      'toque para editar': 'tap to edit', 'Recalcular pelo padrão': 'Reset to default',
      'Ver orçamento': 'View estimate', 'Orçamento': 'Estimate', 'Situação': 'Status',
      'Rascunho': 'Draft', 'Em análise': 'Pending', 'Fechado': 'Won', 'Recusado': 'Lost',
      'Margem neste orçamento': 'Margin on this estimate', 'Sem margem': 'No margin',
      'Aplicar margem': 'Apply margin', 'Editar cliente': 'Edit customer',
      'Rever medições': 'Review measurements', 'Desconto comercial ($)': 'Discount ($)',
      'Imposto (%)': 'Tax (%)', 'Total': 'Total', 'Salvar orçamento': 'Save estimate',
      'Gerar PDF': 'Generate PDF', 'Compartilhar': 'Share',
      'Excluir orçamento': 'Delete estimate',
      'Idioma': 'Language', 'Empresa': 'Company', 'Nome da empresa': 'Company name',
      'Licença / CGC #': 'License #', 'Preços de venda': 'Pricing',
      'Calha 5" material ($/ft)': '5" gutter material ($/ft)',
      'Calha 6" material ($/ft)': '6" gutter material ($/ft)',
      'Calha 7" material ($/ft)': '7" gutter material ($/ft)',
      'Calha 7"': '7" gutter', 'Calha 5"': '5" gutter', 'Calha 6"': '6" gutter',
      'Acessórios da calha 7"': '7" gutter accessories',
      'Downspout 3x4 ($/ft)': 'Downspout 3x4 ($/ft)', 'Elbow 3x4 ($)': 'Elbow 3x4 ($)',
      'Miter 7" ($)': 'Miter 7" ($)', 'End cap 7" ($)': 'End cap 7" ($)',
      'Hanger 7" ($)': 'Hanger 7" ($)',
      'Mão de obra ($/ft)': 'Labor ($/ft)',
      'Valor mínimo do serviço ($)': 'Minimum job ($)', 'Minha margem (%)': 'My margin (%)',
      'Regras de cálculo': 'Calculation rules', 'Hanger a cada (pol.)': 'Hanger every (in.)',
      '1 downspout a cada (ft)': '1 downspout every (ft)',
      'Perda de material (%)': 'Material waste (%)', 'Fator de calibração': 'Calibration factor',
      'Conta na nuvem': 'Cloud account', 'Senha atual': 'Current password',
      'Nova senha': 'New password', 'Trocar senha': 'Change password',
      'Vendedores': 'Salespeople', 'Adicionar vendedor': 'Add salesperson',
      'Acesso': 'Access', 'Salvar configurações': 'Save settings',
      'Exportar dados (backup)': 'Export data (backup)',
      'Forçar atualização do app': 'Force app update', 'Versão instalada:': 'Installed version:',
      'Custo total': 'Total cost', 'Material': 'Material', 'Mão de obra': 'Labor',
      'Sobra para você': 'Your profit', 'Desconto dado': 'Discount given',
      'ft': 'ft', 'Nível:': 'Level:', 'dois dedos ampliam': 'pinch to zoom'
    },
    es: {
      'Usuário': 'Usuario', 'Senha': 'Contraseña', 'Entrar': 'Entrar',
      'Primeiro acesso:': 'Primer acceso:', '— troque em Configurações.': '— cámbiela en Ajustes.',
      'Bem-vindo': 'Bienvenido', 'Vendedor': 'Vendedor',
      'Verificando conexão…': 'Verificando conexión…', 'Sincronizar': 'Sincronizar',
      'Orçamentos no mês': 'Presupuestos del mes', 'Fechado no mês': 'Cerrado en el mes',
      'Novo orçamento': 'Nuevo presupuesto',
      'Endereço → medir no satélite → fechar': 'Dirección → medir en satélite → cerrar',
      'Clientes': 'Clientes', 'Histórico': 'Historial', 'Configurações': 'Ajustes',
      'Passo 1 de 4': 'Paso 1 de 4', 'Passo 2 de 4': 'Paso 2 de 4',
      'Passo 3 de 4': 'Paso 3 de 4', 'Passo 4 de 4': 'Paso 4 de 4',
      'Cliente': 'Cliente', 'Nome do cliente': 'Nombre del cliente', 'Telefone': 'Teléfono',
      'Endereço': 'Dirección', 'Cidade': 'Ciudad', 'Estado': 'Estado',
      'Observações': 'Notas', 'Buscar imóvel': 'Buscar propiedad',
      'Medir calhas': 'Medir canaletas', 'Desenhar': 'Dibujar', 'Ajustar': 'Ajustar',
      'Ampliar casa': 'Ampliar casa', 'Medições': 'Mediciones', 'Desfazer': 'Deshacer',
      'Nova linha': 'Nueva línea', 'Medir na foto': 'Medir en la foto',
      'Contorno OSM': 'Contorno OSM', 'Ver em 3D': 'Ver en 3D',
      'Realçar': 'Realzar', 'Limpar': 'Limpiar', 'Toque numa linha': 'Toque una línea',
      'Continuar': 'Continuar', 'Térreo': 'Planta baja', 'Apagar linha': 'Borrar línea',
      'linhas': 'líneas', 'cantos': 'esquinas', 'Calcular materiais': 'Calcular materiales',
      'Satélite ampliado': 'Satélite ampliado', 'Traçar calhas': 'Trazar canaletas',
      'toque nos cantos do beiral': 'toque las esquinas del alero',
      'Tela cheia': 'Pantalla completa', 'Ângulo 90°': 'Ángulo 90°', 'Fechar volta': 'Cerrar contorno',
      'medido no satélite': 'medido en satélite', 'Concluir': 'Concluir',
      'Resumo': 'Resumen', 'LINEAR FEET NO TOTAL': 'PIES LINEALES TOTALES',
      'Medido no satélite': 'Medido en satélite', 'Lados cobertos': 'Lados cubiertos',
      'Medido em foto': 'Medido en foto', 'fachadas e partes escondidas': 'fachadas y partes ocultas',
      'Anexar foto e medir': 'Adjuntar foto y medir', 'Voltar ao mapa': 'Volver al mapa',
      'Fachada': 'Fachada', 'Referência': 'Referencia', 'Beirais': 'Aleros', 'Descidas': 'Bajantes',
      'Detectar linhas': 'Detectar líneas', 'Alinhar': 'Alinear', 'Encaixar': 'Ajustar a borde',
      'Bordas': 'Bordes', 'Só horizontais': 'Solo horizontales',
      'Garagem dupla 16\'': 'Garaje doble 16\'', 'Garagem simples 9\'': 'Garaje simple 9\'',
      'Porta 3\'': 'Puerta 3\'', 'Janela simples · larg 3\'': 'Ventana simple · 3\' ancho',
      'Janela dupla · larg 6\'': 'Ventana doble · 6\' ancho', 'Janela · altura 5\'': 'Ventana · 5\' alto',
      'Régua da imagem': 'Escala de la imagen', 'Referência de escala:': 'Referencia de escala:',
      'Somar ao orçamento': 'Sumar al presupuesto', 'Lado da casa:': 'Lado de la casa:',
      'Casa inteira': 'Casa entera', 'Frente': 'Frente', 'Direita': 'Derecha',
      'Fundo': 'Atrás', 'Esquerda': 'Izquierda', 'Nova foto': 'Nueva foto', 'Galeria': 'Galería',
      'Escolher imagem': 'Elegir imagen', 'Tirar foto agora': 'Tomar foto ahora',
      'Escolher da galeria': 'Elegir de la galería',
      'Materiais': 'Materiales', 'Pavimentos': 'Pisos', 'Cor / acabamento': 'Color / acabado',
      '1 andar': '1 piso', '2 andares': '2 pisos', '3 andares': '3 pisos',
      'Medido:': 'Medido:', 'Lista de material': 'Lista de materiales',
      'toque para editar': 'toque para editar', 'Recalcular pelo padrão': 'Recalcular por defecto',
      'Ver orçamento': 'Ver presupuesto', 'Orçamento': 'Presupuesto', 'Situação': 'Estado',
      'Rascunho': 'Borrador', 'Em análise': 'En análisis', 'Fechado': 'Cerrado', 'Recusado': 'Rechazado',
      'Margem neste orçamento': 'Margen en este presupuesto', 'Sem margem': 'Sin margen',
      'Aplicar margem': 'Aplicar margen', 'Editar cliente': 'Editar cliente',
      'Rever medições': 'Revisar mediciones', 'Desconto comercial ($)': 'Descuento ($)',
      'Imposto (%)': 'Impuesto (%)', 'Total': 'Total', 'Salvar orçamento': 'Guardar presupuesto',
      'Gerar PDF': 'Generar PDF', 'Compartilhar': 'Compartir',
      'Excluir orçamento': 'Eliminar presupuesto',
      'Idioma': 'Idioma', 'Empresa': 'Empresa', 'Nome da empresa': 'Nombre de la empresa',
      'Licença / CGC #': 'Licencia #', 'Preços de venda': 'Precios',
      'Calha 5" material ($/ft)': 'Canaleta 5" material ($/ft)',
      'Calha 6" material ($/ft)': 'Canaleta 6" material ($/ft)',
      'Calha 7" material ($/ft)': 'Canaleta 7" material ($/ft)',
      'Calha 7"': 'Canaleta 7"', 'Calha 5"': 'Canaleta 5"', 'Calha 6"': 'Canaleta 6"',
      'Acessórios da calha 7"': 'Accesorios de canaleta 7"',
      'Downspout 3x4 ($/ft)': 'Bajante 3x4 ($/ft)', 'Elbow 3x4 ($)': 'Codo 3x4 ($)',
      'Miter 7" ($)': 'Esquina 7" ($)', 'End cap 7" ($)': 'Tapa 7" ($)',
      'Hanger 7" ($)': 'Soporte 7" ($)',
      'Mão de obra ($/ft)': 'Mano de obra ($/ft)',
      'Valor mínimo do serviço ($)': 'Trabajo mínimo ($)', 'Minha margem (%)': 'Mi margen (%)',
      'Regras de cálculo': 'Reglas de cálculo', 'Hanger a cada (pol.)': 'Soporte cada (pulg.)',
      '1 downspout a cada (ft)': '1 bajante cada (ft)',
      'Perda de material (%)': 'Merma de material (%)', 'Fator de calibração': 'Factor de calibración',
      'Conta na nuvem': 'Cuenta en la nube', 'Senha atual': 'Contraseña actual',
      'Nova senha': 'Nueva contraseña', 'Trocar senha': 'Cambiar contraseña',
      'Vendedores': 'Vendedores', 'Adicionar vendedor': 'Agregar vendedor',
      'Acesso': 'Acceso', 'Salvar configurações': 'Guardar ajustes',
      'Exportar dados (backup)': 'Exportar datos (respaldo)',
      'Forçar atualização do app': 'Forzar actualización', 'Versão instalada:': 'Versión instalada:',
      'Custo total': 'Costo total', 'Material': 'Material', 'Mão de obra': 'Mano de obra',
      'Sobra para você': 'Su ganancia', 'Desconto dado': 'Descuento dado',
      'Nível:': 'Nivel:', 'dois dedos ampliam': 'pellizque para ampliar'
    }
  };

  var lang = 'pt';

  function detect() {
    try {
      var saved = localStorage.getItem('rainline.lang');
      if (saved && (saved === 'pt' || saved === 'en' || saved === 'es')) return saved;
    } catch (e) {}
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'pt';
    nav = String(nav).toLowerCase();
    if (nav.indexOf('es') === 0) return 'es';
    if (nav.indexOf('pt') === 0) return 'pt';
    return 'en';
  }

  function t(txt) {
    if (lang === 'pt') return txt;
    var d = DICT[lang];
    if (!d) return txt;
    var k = String(txt).trim();
    if (d[k]) return d[k];
    // tenta sem pontuação final
    var k2 = k.replace(/[:：]\s*$/, '');
    if (d[k2]) return d[k2] + ':';
    return txt;
  }

  // troca o texto de toda a página
  function apply() {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return;
      if (node.parentNode && /SCRIPT|STYLE/.test(node.parentNode.tagName)) return;
      if (!node.__orig) node.__orig = node.nodeValue;
      var raw = node.__orig.trim();
      var out = t(raw);
      if (out !== raw) node.nodeValue = node.__orig.replace(raw, out);
      else node.nodeValue = node.__orig;
    });
    // placeholders e aria-label
    Array.prototype.forEach.call(document.querySelectorAll('[placeholder]'), function (el) {
      if (!el.__ph) el.__ph = el.getAttribute('placeholder');
      el.setAttribute('placeholder', t(el.__ph));
    });
  }

  function set(l) {
    lang = l;
    try { localStorage.setItem('rainline.lang', l); } catch (e) {}
    apply();
  }

  global.I18N = {
    get lang() { return lang; },
    t: t, set: set, apply: apply, detect: detect,
    init: function () { lang = detect(); apply(); }
  };
})(window);
