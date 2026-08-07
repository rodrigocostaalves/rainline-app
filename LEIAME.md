# RainLine — v0.17

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
