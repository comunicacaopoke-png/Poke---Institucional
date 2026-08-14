# POKE — Arquitetura recomendada para WordPress + painel administrativo

## Princípio
O site público não deve depender de Google Apps Script para carregar conteúdo. Isso prejudica velocidade, Core Web Vitals, indexação e estabilidade.

A melhor arquitetura é:

1. WordPress renderiza o conteúdo público no servidor.
2. O painel administrativo pode ser feito em Google Apps Script.
3. Ao salvar uma alteração no painel, o Apps Script envia a mudança para o WordPress pela REST API ou por um endpoint privado criado no tema/plugin.
4. O WordPress grava o valor imediatamente em options, custom fields ou custom post types.
5. O visitante recebe HTML pronto do WordPress, sem esperar Apps Script.

## O que deve ser variável no painel

### Configurações gerais
- SEO title e description
- URL canônica
- links sociais
- e-mail
- telefone
- cidade
- CTA global

### Home
- eyebrow do hero
- título do hero
- texto do hero
- imagem/vídeo do hero
- textos da seção institucional
- manifesto
- CTA final
- ordem e visibilidade das seções

### Serviços
- título
- resumo
- slug
- ordem
- status ativo/inativo

### Produtos
- nome
- tagline
- resumo
- imagem
- URL
- ordem
- status

### Projetos
- cliente
- nome do projeto
- categorias
- resumo
- desafio
- solução
- resultados
- capa
- galeria
- URL/slug
- SEO title
- SEO description
- status rascunho/publicado

### Artigos
Use o próprio post type nativo do WordPress. O painel Apps Script pode criar/editar posts via REST API, mas o conteúdo deve continuar armazenado no WordPress.

## SEO técnico previsto
- 1 H1 por página
- estrutura semântica H2/H3
- title e description individuais
- canonical
- Open Graph
- sitemap XML do WordPress
- schema Organization na Home
- schema Article em artigos
- schema BreadcrumbList nas páginas internas
- URLs limpas
- alt text gerenciável para imagens
- imagens WebP/AVIF no WordPress
- lazy loading abaixo da dobra
- conteúdo principal renderizado no servidor
- artigos estruturados por clusters de busca
- páginas próprias para serviços, produtos e projetos

## Arquitetura de páginas
- /
- /quem-somos/
- /produtos/
- /produtos/ping/
- /projetos/
- /projetos/{slug}/
- /artigos/
- /artigos/{slug}/
- /contato/
- /produtos-digitais/
- /sites-experiencias/
- /sistemas-automacoes/
- /marca-comunicacao/

As quatro últimas páginas são importantes para busca orgânica. Não devem existir apenas como trechos da Home.

## Segurança do painel Apps Script
- Nunca colocar token do WordPress no HTML público.
- Guardar URL, usuário e senha de aplicação/token nas Script Properties do Apps Script.
- Criar endpoint WordPress com autenticação e escopo apenas para os campos necessários.
- Sanitizar todos os campos antes de gravar.
- Registrar data, usuário e conteúdo alterado em log.

## Próxima etapa
Transformar este HTML em um template de tema WordPress e criar o contrato de dados entre painel Apps Script e WordPress.
