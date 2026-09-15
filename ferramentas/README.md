# Ferramentas POKE

Esta rota é o hub interno para as ferramentas POKE. Ela foi construída como página estática porque o site institucional é hospedado em GitHub Pages.

## Antes de publicar em `main`

GitHub Pages não oferece autenticação por rota e não deve ser usado como proteção do POKE CUT. A publicação da rota `/ferramentas/` requer uma camada de acesso na borda (por exemplo, Cloudflare Access) ou a migração desse hub para um host com autenticação server-side.

O card aponta para a prévia privada do POKE CUT. O acesso à ferramenta é autenticado no host da aplicação, não pelo GitHub Pages.
