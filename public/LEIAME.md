# RainLine — v0.4

App de orçamento de calhas (gutters) para uso em campo. PWA, roda no navegador do
celular e pode ser instalado na tela inicial. Sem back-end: tudo fica no aparelho.

## Como rodar

Precisa ser servido por HTTP (o service worker e o `fetch` não funcionam abrindo o
arquivo direto do disco).

- **Teste local:** `python3 -m http.server 8080` dentro desta pasta → abrir `http://localhost:8080`
- **Publicar:** joga a pasta num repositório e ativa GitHub Pages, ou arrasta para o Cloudflare Pages.

Login inicial: **admin / 1234** (troca em Configurações).

## Testar sem digitar nada
No painel, toque em **"Ver exemplo pronto (casa medida)"**. Ele carrega um cliente
fictício em Winter Garden com o telhado já desenhado (~156 ft, 2 linhas, 2 cantos).
Arraste os pontos amarelos e veja a fita recalcular, depois siga para Materiais →
Orçamento → Gerar PDF para ver o fluxo inteiro.

## O que já funciona

| Tela | Estado |
|---|---|
| Login | local, sem servidor |
| Dashboard | contadores do mês |
| Novo orçamento | dados do cliente + busca de endereço |
| Mapa | satélite, desenho por toque, pontos arrastáveis, comprimento por trecho |
| Materiais | lista calculada, toda quantidade editável |
| Preços | modo "$/pé instalado" ou item a item, com margem |
| Orçamento | proposta em inglês, PDF pela impressão, compartilhar |
| Clientes / Histórico | salvos no aparelho |

## Estrutura

```
index.html          todas as telas
css/app.css         identidade visual
js/materials.js     TODAS as regras de cálculo (mexa aqui para ajustar)
js/app.js           navegação, mapa, telas
sw.js               cache offline do app (tiles não são cacheados)
```

## Achar o imóvel

Na tela do mapa, dois botões no alto à direita:

- **lupa** — busca pelo endereço digitado. Tenta, em ordem: US Census Geocoder
  (o melhor para endereço americano), Nominatim estruturado, Nominatim livre,
  Photon e, por último, centraliza no CEP.
- **alvo** — usa o GPS do aparelho. É o caminho mais rápido em campo, já que o
  vendedor está parado na frente da casa. Precisa autorizar a localização e
  o site precisa estar em HTTPS (o `.workers.dev` já é).

Também dá para colar coordenadas direto no campo de endereço, no formato
`28.5653, -81.5862`.

## Modos do mapa

- **Desenhar** — cada toque cria um ponto na linha ativa.
- **Ajustar** — o toque no mapa não cria nada. Toque numa linha para selecioná-la
  (fica verde), arraste os pontos para corrigir, toque num ponto para apagá-lo.
  Com a linha selecionada: *Continuar* volta a desenhar nela, *Apagar linha* remove.

## Detectar telhado

O botão **Detectar telhado** busca o contorno da edificação no OpenStreetMap
(footprints, boa parte importada da base da Microsoft nos EUA) e desenha o polígono
já pronto, em modo Ajustar. Não é visão computacional — é dado vetorial pronto, que
resolve o mesmo problema sem custo e sem servidor. Onde o prédio não estiver mapeado,
ele avisa e você desenha na mão.

O contorno vem da **parede**, não da beirada do telhado. O beiral costuma avançar de
6" a 18", então confira e arraste os pontos para fora, ou use o fator de calibração.

## Regras de cálculo (padrão, editáveis em Configurações)

- Calha = medido + 10% de perda
- Cantos = vértices intermediários de cada linha desenhada
- End caps = 2 por linha aberta (volta fechada não leva end cap)
- Hangers = 1 a cada 24" (padrão Flórida)
- Downspouts = 1 a cada 35 ft, mínimo 1 por linha
- Comprimento da descida = 12 ft (1 andar) / 22 ft (2) / 32 ft (3)
- Elbows = 3 por descida · Straps = 2 por andar · Splash block = 1 por descida

## Limites conhecidos da v0.1

- **Login não é segurança de verdade.** É só um cadeado local.
- **Imagens de satélite:** camada Esri World Imagery, ótima para testar. Para uso
  comercial em escala, contratar Google Maps, Mapbox ou Nearmap.
- **Busca de endereço:** Nominatim (OpenStreetMap), gratuito e com limite de uso.
  Em produção, trocar por Google Geocoding.
- **Precisão:** a foto de satélite é ortogonal, então beiral horizontal mede certo.
  Erro típico de 1–3 ft por causa da resolução e do beiral projetado. Use o
  **fator de calibração** em Configurações: meça uma parede conhecida e ajuste.
- Dados só neste aparelho. Trocou de celular, perdeu — use "Exportar dados".

## Próximos passos sugeridos

**v0.2** — Cloudflare Worker + D1 para login real e orçamentos na nuvem (mesmo
padrão do VipRide), múltiplos vendedores, PDF de verdade em vez de impressão.

**v0.3 (IA)** — detecção automática do contorno do telhado. Caminho mais barato:
usar Segment Anything ou um modelo de segmentação de edificações na imagem de
satélite, vetorizar o contorno, simplificar com Douglas-Peucker e devolver os
pontos para o mesmo editor que já existe aqui. O vendedor só arrasta o que ficou
errado — a UI não muda.
