# Ferramentas POKE

Esta rota é o hub interno para as ferramentas POKE. Ela foi construída como página estática porque o site institucional é hospedado em GitHub Pages.

## Antes de publicar em `main`

GitHub Pages não oferece autenticação por rota e não deve ser usado como proteção do POKE CUT. A publicação da rota `/ferramentas/` requer uma camada de acesso na borda (por exemplo, Cloudflare Access) ou a migração desse hub para um host com autenticação server-side.

Enquanto essa configuração não existir, o card permanece em estado `EM IMPLANTAÇÃO` e não expõe a aplicação nem um link de acesso.
