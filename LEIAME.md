# RainLine — v0.28

## Selecionar a casa por retângulo

O crescimento por cor a partir de um toque não deu conta — vazava para o vizinho
ou parava na metade do telhado. Agora você delimita a casa:

1. Botão **Selecionar casa**.
2. Toque num canto do terreno.
3. Toque no canto oposto. Aparece o retângulo tracejado.
4. O app extrai o telhado dentro dele e devolve cada lado como candidata. Você
   toca só nos que levam calha, ou usa **Aceitar lados** e apaga o resto no modo
   Ajustar.

### Como ele acha o telhado dentro do retângulo

Agrupa os pixels em cinco grupos de cor e fica com **todos os grupos que aparecem
de verdade no miolo do retângulo** (12% ou mais). Essa é a parte que resolve o
telhado com um lado no sol e outro na sombra: são duas cores bem diferentes, mas
as duas estão no meio. Grama, calçada e rua ficam nas bordas e não entram.

Depois fecha os buracos da textura de telha, mantém só a mancha ligada ao centro
— o que descarta o vizinho, mesmo que ele tenha cor parecida — contorna e
simplifica em poucos cantos.

### Testado

Casa com metade no sol e metade na sombra, entre dois vizinhos colados:

| Retângulo | Resultado |
|---|---|
| justo | acertou, sobrando ~10 px |
| folgado | exato |
| bem folgado, pegando os vizinhos | exato |

Telhado uniforme entre três casas coladas: exato também.

**Prefira o retângulo folgado**, com uma margem de grama em volta. Foi o que deu
resultado mais limpo — o algoritmo precisa enxergar o que **não** é telhado para
saber onde ele termina.

---

# v0.27

## Detecção no satélite: agora você escolhe a casa

O detector antigo procurava retas na tela inteira — e achava vizinho, calçada,
meio-fio e rua. Você tinha razão: sem saber qual é a casa, ele não tem como
acertar.

O botão virou **Selecionar casa**. O fluxo:

1. Toque em **Selecionar casa**.
2. Toque no meio do telhado da casa do cliente.
3. O app cresce uma região a partir dali seguindo a cor do telhado, fecha os
   buracos da textura de telha, contorna a mancha e simplifica o contorno em
   poucos cantos.
4. Cada lado do telhado vira uma candidata tracejada. Você toca só nos que levam
   calha — ou usa **Aceitar lados** e depois apaga os que não servem, no modo
   Ajustar.

Como ele cresce a partir do seu toque, ele para onde o telhado acaba: vizinho,
grama e rua ficam de fora por construção, não por filtro.

Testado numa imagem sintética com três casas coladas: tocando na do meio, ele
delimitou exatamente aquela — caixa de 380×150 a 700×640 px, os dois vizinhos
ignorados, quatro cantos.

**Se não funcionar bem numa casa:** toque numa parte mais uniforme do telhado,
longe de sombra de árvore e de claraboia. Telhado com metade no sol e metade na
sombra pode sair pela metade — nesse caso, toque no lado que falta e aceite os
lados que aparecerem.

## Imposto com centavos

O campo aceita duas casas decimais e vírgula. **6,5%** funciona.

---

# v0.26

## Correção: o PDF saía com a foto sem as marcações

Bug que eu introduzi na v0.24. Naquela versão passei a guardar os pontos em
coordenada relativa (0 a 1) para resolver a reabertura da foto — mas o desenho do
PDF continuou tratando os mesmos números como pixel. Resultado: as linhas eram
desenhadas num canto de 1 px, invisíveis.

Agora a proposta sai com o beiral em amarelo, a referência em ciano e as descidas
em laranja, com traço proporcional ao tamanho do papel.

## Preço: só custo de material

O modo "preço por pé" saiu. Ficou um caminho só: você cadastra o custo de cada
item e a mão de obra por pé, e o app soma o custo real do trabalho.

## Margem: só percentual, e você enxerga em dólar

Um campo em Configurações: **Minha margem (%)**. Na tela do orçamento, dois botões
— **Sem margem** / **Aplicar margem** — e agora o selecionado fica destacado
(verde quando aplicada).

Abaixo deles, uma caixa que **só existe no app**:

```
Custo + mão de obra      $2.247,50
Margem 20%                 $449,50
Desconto dado             -$150,00
Sobra para você            $299,50
Equivale a 13,3% sobre o custo.
```

Se o desconto passar da margem, o valor fica vermelho e o aviso diz que o trabalho
sai no prejuízo. É esse número que responde a sua pergunta na hora de fechar: dá
para dar desconto, e de quanto.

Essa caixa **nunca** vai para o PDF nem para o compartilhamento. Na proposta, a
margem é diluída entre os itens — o cliente vê os valores finais e nada mais.

## Os botões saíram de cima da imagem

**No mapa:** a coluna da direita virou uma faixa no rodapé, logo acima da fita.
Uma linha só, que rola para o lado com o dedo — os 11 botões continuam todos lá,
mas nenhum fica sobre o telhado. O mapa ficou com a parte de cima inteira livre.

**Na foto:** o painel agora tem teto de 58% da tela. Antes ele crescia até cobrir
tudo. Recolhido, a foto fica com cerca de 410 px; aberto, com 290; e no botão
**Tela toda**, com 773.

## Correção que vinha desde a v0.24

Uma regra de estilo tinha colidido com outra e escondia as referências de escala
permanentemente. Se você tentou trocar a referência na v0.24 e não apareceu nada,
era isso.

## Detecção de telhado no satélite: refeita

Antes ela buscava o contorno da edificação no OpenStreetMap — o que dá a **parede
inteira**, incluindo lados onde não vai calha nenhuma.

Agora ela usa a mesma matemática da foto, aplicada à imagem de satélite: recorta o
que está na tela, acha as bordas e as retas, e devolve cada água do telhado como
uma **candidata tracejada**. Você toca só nas que levam calha.

Isso respeita como o serviço funciona de verdade: calha vai onde a água escorre,
não em todo lado do telhado. Um detector que marcasse o contorno inteiro estaria
sempre errando por excesso — e um contorno automático "perfeito" seria pior, porque
ninguém além de você sabe para onde cada água corre.

O contorno do OpenStreetMap continua disponível no botão **Contorno OSM**, para
quando você quiser o perímetro pronto. E se a análise da imagem não achar nada, ele
cai nesse contorno sozinho.

---

# v0.24

## Botão voltar do aparelho

Antes ele saía do app e você perdia o trabalho. Agora **anda dentro do app**:
orçamento → mapa → cliente → painel. Só quando você já está no painel é que ele
pergunta "Sair do RainLine?" — e se houver orçamento ainda não enviado para a
nuvem, o aviso diz quantos.

Fechar a aba com um orçamento em edição também passa a avisar.

## Correção: reabrir a foto bagunçava tudo

Duas causas somadas:

1. **Coordenadas absolutas.** Ao salvar, a foto é reduzida para 1280 px, mas as
   marcações ficavam guardadas em pixels da imagem original. Ao reabrir, tudo caía
   fora do lugar. Agora são guardadas em coordenada relativa e voltam certas em
   qualquer tamanho.
2. **Unidade errada.** A referência é gravada em pés; se a última foto tivesse
   usado metros, ao reabrir ele multiplicava de novo por 3,28. A unidade agora é
   forçada para pés na reabertura.

E um terceiro, que explicava as marcações "indo para outro lugar da tela": quando
o painel mudava de altura, o app não recalculava onde a foto estava desenhada, e
o toque caía deslocado. Agora um observador de tamanho refaz essa conta a cada
mudança de layout — abrir opções, tela toda, girar o aparelho.

## Descidas (downspouts)

Passo **3 · Descidas** na tela da foto. Trace uma linha por descida, de cima até o
chão. Elas aparecem em **laranja**, são **contadas** e **não entram na metragem de
calha** — o contador mostra "2 descida(s)" ao lado da escala.

Na lista de materiais, a quantidade marcada substitui a estimativa automática, e
elbows e splash blocks acompanham.

## Referências viraram um botão

No lugar de seis fileiras de chips ocupando a tela, um botão só: **Referência de
escala: garagem dupla 16 ft ▾**. Toca e expande.

## Nível saiu da tela da foto

Como você não usa, saiu dali. Continua disponível na tela de Medições, item por
item, para quem precisar separar térreo de segundo andar.

## Lado da casa: Casa inteira

Opção nova, primeira da lista. Para quando a foto é de satélite e já cobre tudo —
ela marca os quatro lados como cobertos de uma vez.

## Margem em valor ou percentual

Em Configurações → Preços, dois campos novos: **Minha margem ($)** e
**Minha margem (%)**. Ficam guardados os dois.

Na tela do orçamento, uma linha **Margem neste orçamento** com três opções:
Nenhuma · Valor · Percentual. Você escolhe na hora, trabalho a trabalho.

A margem **nunca aparece na proposta impressa** — é diluída nos itens antes de
gerar o PDF, como já acontecia com a margem do modo item a item.

---

# v0.23

## Foto de celular agora recebe tratamento próprio

Foto tirada do chão tem um inimigo que print de satélite não tem: **textura**.
Grama, arbustos, folhagem e as fileiras de telha produzem milhares de bordinhas
curtas, e o detector as tratava com o mesmo peso da linha da calha.

Três mudanças no processamento:

1. **Desfoque gaussiano antes do gradiente.** É o que separa textura de estrutura:
   detalhe fino some no borrão, linha longa sobrevive. Sem isso o app via mato com
   a mesma força que calha.
2. **Supressão de não-máximos.** Uma borda de 4 px de largura vira uma linha de
   1 px, e as retas passam a casar em vez de se perder na espessura.
3. **Filtro "Só horizontais"** (ligado por padrão). Calha em foto de fachada é
   quase horizontal — a perspectiva inclina um pouco, nunca vira vertical. Isso
   corta tronco, cerca e poste. Desligue o botão se precisar de outra direção.

E o app passa a mostrar só as 12 linhas mais longas, em vez de 22: a calha
costuma ser a maior linha reta da foto.

## As 4 fotos — o que dá e o que não dá

**Juntar as 4 numa imagem só não ajuda.** Panorama é uma projeção cilíndrica: cada
parede fica num ângulo diferente e a distorção aumenta em vez de diminuir. Você
mediria pior do que medindo cada foto separada.

Montar um modelo 3D de verdade a partir das 4 fotos é fotogrametria — servidor com
GPU, e é literalmente o que o EagleView vende por US$ 15 a 38 o relatório.

**O que funciona é o oposto: manter as fotos separadas.** Cada parede é fotografada
de frente, com a sua própria referência naquela parede, e o app soma. Sem
distorção, porque cada medição acontece no plano em que ela é válida.

Para isso a foto agora tem **lado da casa**: Frente · Direita · Fundo · Esquerda.
Na tela de Medições apareceu um quadro **Lados cobertos** com os quatro, marcando
em verde os já medidos — assim você não fecha o orçamento tendo esquecido o fundo.

---

# v0.22

## Correção grave: não dava para marcar ponto em print de celular

Print de celular é alto e estreito. Encaixado na tela, ele fica pequeno — e o
código tratava qualquer toque a menos de 20 px de um ponto existente como
"arrastar aquele ponto". Com a imagem pequena, esses 20 px de tela equivaliam a
centenas de pixels da imagem: **o segundo toque agarrava o primeiro ponto em vez
de criar um novo.**

Consequência em cadeia: nunca fechava a referência → nunca havia escala → a
detecção nem chegava a rodar. O "não detecta" era sintoma, não causa.

Agora vale a regra normal de toque: **tocar cria ponto; pressionar e arrastar move
o ponto.** Só vira arrasto depois que o dedo anda 5 px de verdade.

## Detecção com limiar adaptativo

O corte que separa "borda" de "ruído" era fixo. Como a intensidade é normalizada
pela borda mais forte da imagem, a **barra preta do navegador** no topo do print
virava o máximo e empurrava a borda do telhado para baixo do corte. O app enxergava
o contorno na camada Bordas, mas o detector o descartava.

Agora o corte sai do histograma da própria imagem (percentil 6), limitado entre 22
e 110. E se a primeira passada achar menos de 3 linhas, ele repete mais permissivo,
até três tentativas.

Testado num print sintético de 1080×2400 com barras pretas: **22 linhas
encontradas, contorno do telhado inteiro incluído.**

---

# v0.21

## Orçamento salvo deixou de ser beco sem saída

Abrindo um orçamento pelo **Histórico**, ele carrega inteiro — cliente, medições,
materiais e preço — e no topo aparece um cartão novo com duas fileiras.

### Situação comercial

**Rascunho · Em análise · Fechado · Recusado**, cada um com sua cor. A troca é
gravada na hora, sem precisar salvar de novo, e sobe para a nuvem junto.

A etiqueta aparece na lista do Histórico, então você bate o olho e vê o que está
pendurado esperando resposta do cliente.

### Ações rápidas

- **Editar cliente** — abre o formulário preenchido; ao salvar, volta direto para
  o orçamento (não recomeça o fluxo do mapa).
- **Rever medições** — abre o mapa já enquadrado nas linhas que existem, para
  corrigir um canto e recalcular.
- **Materiais** — volta para a lista, onde toda quantidade continua editável.

E **Excluir orçamento** no fim da tela, com confirmação. Some do aparelho e da
nuvem.

### Desconto comercial

O campo já existia, mas agora faz sentido: você abre um orçamento antigo, dá o
desconto para fechar a venda, marca como Fechado e o PDF sai atualizado.

### Painel

"Valor no mês" virou **"Fechado no mês"** e passa a somar só o que está marcado
como Fechado. Antes contava proposta enviada como se fosse venda — número bonito
e inútil.

---

# v0.20

## A tela da foto agora abre recolhida

Antes ela abria com o painel inteiro aberto e a foto virava uma tira. Agora abre
recolhida, com a foto grande, e a alça em cima diz **MOSTRAR OPÇÕES** em amarelo.
Quem nunca usou entende sem explicação.

Ficam sempre visíveis os passos, as ferramentas (Detectar linhas · Alinhar ·
Encaixar · Bordas), o total e os botões de traçar. As referências e o zoom só
aparecem quando você abre.

## Tela toda

Botão **⤢ Tela toda** no canto da imagem. Some a barra inteira e a foto ocupa
tudo — de 470 para 773 px de altura no meu teste. Sobram só uns controles
flutuantes por cima: o total, Desfazer, Nova linha e **Opções** para voltar.

É o modo para marcar com precisão.

## Lupa também na foto

Ao arrastar um ponto na foto, abre o mesmo círculo ampliado que já existia no
mapa: mira no centro, as linhas já traçadas por perto e ampliação de mais de 3×
sobre o zoom atual. Antes só o mapa tinha.

## Detecção mais sensível

Baixei os limiares: agora ele aceita retas com menos votos e trechos mais curtos,
e devolve até 22 candidatas em vez de 14. Foto de casa real tem borda mais
quebrada que desenho, e os valores antigos estavam exigentes demais.

**E um aviso que faltava:** se você tocar em Detectar linhas antes de definir a
referência, ele agora avisa em vez de trabalhar à toa. Sem escala, linha detectada
não vira medida — era isso que estava acontecendo no seu teste.

---

# v0.19

## Detectar linhas — a marcação automática

Botão verde **Detectar linhas** na tela da foto. Ele varre a imagem, acha as retas
reais e desenha cada uma tracejada em verde-água. Você toca nas que são calha e
elas viram linha de medição amarela, já com a metragem. As que não interessam
(cumeeira, calçada, muro do vizinho) você simplesmente ignora.

Leva 2 a 4 segundos numa foto de celular.

### Como funciona — e por que não é IA

É a transformada de Hough, matemática de 1962. Cada pixel de borda "vota" em todas
as retas que poderiam passar por ele; as retas mais votadas são as linhas reais da
foto. Depois o app recorta os trechos onde a borda existe de fato.

Escolhi isso em vez de um modelo de visão de propósito. Modelo de linguagem com
visão descreve bem uma imagem — "há um telhado ao centro" — mas erra feio quando
você pede coordenada de pixel. Ele inventa números plausíveis. Para medida que
vira preço, isso é inaceitável. Hough é determinístico: mesma foto, mesmo
resultado, sempre, e sem servidor nem custo.

### Quando ele acerta e quando não

Acerta com foto nítida, telhado contrastando com o céu ou com a parede.
Erra quando a foto está escura, tremida, ou o beiral tem a mesma cor do fundo —
nesses casos ele devolve poucas linhas ou nenhuma. Ligue **Bordas** para ver o
que ele está enxergando: se as bordas somem, a foto não serve.

Ele nunca marca sozinho. Você é quem aceita cada linha — e é assim que deve ser,
porque cada uma vira dinheiro no orçamento.

## Ferramentas separadas do zoom

**Detectar linhas · Alinhar · Encaixar · Bordas** agora ficam numa fileira própria
que **continua visível com o painel recolhido** — são justamente as ferramentas de
que você precisa enquanto traça. Some só o zoom e as referências.

---

# v0.18

## Painel de opções recolhível

A barra de baixo da tela da foto agora recolhe. Toque na alça (o tracinho no topo
dela, com o texto "esconder opções").

- **Expandido** — tudo à vista: zoom, referências, níveis, trocar imagem.
- **Recolhido** — some o zoom, as referências e os níveis. Ficam os passos, o
  total e os botões de traçar. A foto passa de cerca de 230 px para 560 px de
  altura, mais que o dobro.

Ele **recolhe sozinho** assim que você fecha a referência, porque a partir dali os
botões de escala não servem mais e o que importa é enxergar o telhado. Para voltar,
toque na alça de novo.

O zoom de dois dedos continua funcionando com o painel recolhido.

---

# v0.17

## Usar a régua do Google Earth como referência

Chip **Régua da imagem** na tela da foto, mais um seletor **ft / m** ao lado do
campo. Fluxo: digite o número que a régua mostra (ex.: 9), escolha `m`, e trace
em cima da barra branca, ponta a ponta. Pronto — a escala sai dali.

### O aviso que importa

**Só funciona em vista de cima.** Na imagem inclinada do Google Earth a escala
muda dentro do próprio quadro: o que está no fundo aparece menor que o que está
na frente, e a régua só vale para a faixa onde ela está desenhada. Medir o
telhado inteiro com ela daria erro grande.

No Google Earth existe o botão **2D** no canto direito. Ative antes de tirar o
print. Aí a régua vale para a imagem inteira.

A vista inclinada continua útil — para **enxergar** onde estão os beirais do
térreo escondidos. Para medir, use a de cima.

## Alinhar

Botão **Alinhar** ao lado de Bordas. Depois de traçar por cima, ele empurra cada
trecho para a reta de maior contraste ali perto (testa pequenas variações de
ângulo e deslocamento) e recalcula os cantos como interseção das retas vizinhas —
que é como um canto de telhado se comporta de verdade.

Serve para tirar o tremido do dedo. Se um trecho ficar sem borda nítida, ele
mantém o que você desenhou em vez de inventar. Confira sempre antes de somar.

---

# Backend na nuvem (v0.16)


App de orçamento de calhas. A partir desta versão os orçamentos ficam num banco de
dados na sua conta Cloudflare, com login de verdade e fotos guardadas no R2 — sem
deixar de funcionar offline.

## Estrutura do repositório

```
wrangler.jsonc        configuração do deploy (bindings do banco e do bucket)
.assetsignore
worker/index.js       a API  (/api/...)
worker/schema.sql     as tabelas do banco
public/               o app  (o que o navegador baixa)
```

Suba tudo mantendo essas pastas. O `public/` continua sendo o que vai para o navegador.

---

# Passo a passo da instalação (faça uma vez)

## 1. Criar o banco D1

Cloudflare → **Storage & Databases** → **D1** → *Create database*
Nome: `rainline`

Copie o **Database ID** que aparece e cole no `wrangler.jsonc`, no lugar de
`COLE_AQUI_O_ID_DA_SUA_BASE`.

## 2. Criar as tabelas

Na base recém-criada, abra a aba **Console** e cole o conteúdo de
`worker/schema.sql`. Execute.

Isso cria as tabelas e o usuário inicial **admin / 1234**.

## 3. Criar o bucket das fotos

Cloudflare → **R2** → *Create bucket*
Nome: `rainline-photos`

## 4. Publicar

Faça o commit e o deploy roda sozinho. No log deve aparecer a leitura dos arquivos
de `/public` e o upload do Worker.

## 5. Conferir

Abra `https://seu-endereco.workers.dev/api/health` — deve responder
`{"ok":true,...}`. Se responder outra coisa, algum binding está faltando.

## 6. Trocar a senha

Entre no app com **admin / 1234** e vá em Configurações → Conta na nuvem →
**Trocar senha**. Faça isso antes de qualquer outra coisa: a senha inicial está
escrita neste arquivo e no seu repositório público.

---

## Como funciona no dia a dia

**Login** — agora é validado no servidor. A senha fica guardada como hash PBKDF2
com 100 mil iterações e sal próprio; nem eu nem você conseguimos ler a senha a
partir do banco.

**Vendedores** — logado como admin, em Configurações aparece a lista de usuários e
um formulário para criar vendedores. Cada vendedor vê só os próprios orçamentos; o
admin vê todos.

**Sincronização** — a barra no topo do painel mostra o estado:

| Cor | Significado |
|---|---|
| verde | tudo sincronizado |
| amarelo | há orçamentos esperando para subir |
| vermelho | sem servidor — trabalhando offline |

**Offline** — se o servidor não responder (sinal ruim no quintal do cliente), o
app entra em modo local: o login usa a senha guardada em Configurações e os
orçamentos ficam marcados como pendentes. Quando a internet voltar, ele envia
sozinho — ou toque em **Sincronizar**.

**Fotos** — ao salvar, cada foto vai para o R2 e o app apaga a cópia em base64 do
aparelho, guardando só a chave e a miniatura. Isso resolve de vez o problema de
memória cheia: antes cada foto ocupava uns 200 KB do limite de 5 MB do navegador.

**Trocar de celular** — entre com o mesmo usuário e os orçamentos descem sozinhos.

---

## Sobre custo

D1 e R2 têm faixa gratuita generosa para o volume de uma empresa de calhas: são
milhares de leituras por dia e vários gigabytes de foto antes de sair do gratuito.
Confira os limites atuais no painel, porque a Cloudflare ajusta de tempos em tempos.

## O que ainda não existe

Assinatura digital, link de pagamento, agenda e QuickBooks. Todos dependiam deste
backend — agora têm onde se apoiar.
