# AnimeDesk

Aplicativo desktop em desenvolvimento para centralizar biblioteca de animes e mangás, progresso, agenda de lançamentos, alertas e integrações com trackers/streamings.

## Estado atual

A primeira base funcional já inclui:

- Tauri 2 + Rust + React + TypeScript + Vite como shell principal.
- Electron preservado temporariamente apenas como fallback.
- Janela desktop nativa validada no Windows.
- SQLite nativo com migrações automáticas e fallback localStorage no navegador.
- Migração automática do conteúdo localStorage para SQLite na primeira execução Tauri.
- System tray: fechar a janela oculta o app; clique no tray restaura.
- Autostart configurável nas preferências.
- Notificações nativas do Windows com teste pela interface.
- Dashboard com estatísticas locais.
- Busca real de animes e mangás diretamente no MyAnimeList pelo backend Rust no Tauri; o cliente usa TLS nativo do Windows. Jikan permanece para recursos complementares/modo web quando acessível.
- Cache local de capas: ao adicionar pelo Explorar, o Tauri baixa a imagem para `AppData\\com.animedesk.app\\covers` e passa a usar a cópia offline. Validado end-to-end na 0.4.2 com 5/5 títulos da biblioteca usando arquivos locais JPEG válidos.
- Integração oficial MyAnimeList OAuth2 + PKCE 0.5.0: login pelo navegador, callback loopback local, refresh automático, tokens no Windows Credential Manager e importação autenticada das listas de anime/mangá. A 0.5.0 é somente leitura (MAL → AnimeDesk).
- Importação de biblioteca do MyAnimeList por `.xml` ou `.xml.gz`, com preview, merge por MAL ID, status, progresso, nota e proteção contra duplicados.
- Enriquecimento automático pós-importação: resolve MAL ID → Kitsu em lotes de 20, preenche capa/sinopse/gêneros/ano/score público/totais quando disponíveis, preserva dados pessoais e baixa capas offline.
- Fila de enriquecimento com progresso, cancelamento, falhas por item, retry e execução em segundo plano mesmo ao trocar de tela.
- Sistema de descoberta 0.2.0 com Kitsu: tendências, temporada, populares, melhor avaliados, próximas estreias e recomendações locais.
- Todo item de descoberta precisa ser resolvido para MAL ID real via Kitsu mappings antes de entrar no app.
- Cache local da última vitrine de descoberta por até 7 dias, com recálculo das recomendações usando a biblioteca atual.
- Explicações de recomendação 0.2.2: os cards personalizados mostram fatores como afinidade de gêneros, título semelhante da sua biblioteca, nota pública, popularidade e recência.
- Afinidade por estúdio 0.4.3: `studios[]` é persistido via migration 0002, Kitsu fornece estúdios quando disponíveis e o MyAnimeList público complementa títulos sem `role=studio`; o recomendador usa esse sinal opcional sem penalizar obras sem estúdio conhecido.
- Normalizador de IDs externos 0.3.0: cada mídia pode carregar vários IDs (myanimelist/anime, myanimelist/manga, kitsu, tmdb, crunchyroll etc.), persistidos em external_media_ids e resolvidos de volta para a mídia local.
- UI de mappings 0.4.1 em Integrações: selecionar uma obra, inspecionar provider/ID/confidence/verified, adicionar mappings manuais verificados, detectar conflitos e remover mappings auxiliares; o MAL ID canônico é protegido.
- Persistência de estado 0.3.1: preferências de alertas, cache de descoberta, cache semanal da agenda, marcadores de notificações e timestamps de last-sync usam SQLite no Tauri, com migração automática do localStorage legado e fallback web.
- Releases da biblioteca encontrados pela Agenda também são normalizados na tabela `releases`, com deduplicação explícita.
- Testes automatizados com Vitest + happy-dom; na 0.5.0 a suíte soma 28 testes frontend, além de 6 testes Rust cobrindo OAuth/PKCE, mapeamento de listas MAL e parser de estúdios.
- Parser XML do MAL endurecido para usar APIs XML nativas (`getElementsByTagName`) em vez de depender de seletores CSS.
- Biblioteca com status, progresso e histórico manual de episódios/capítulos.
- Tela **Histórico e estatísticas** 0.4.0 baseada no SQLite: totais de anime/mangá, concluídos/em andamento/planejados, episódios, capítulos, horas estimadas, nota média pessoal, gêneros, atividade dos últimos 6 meses, origem por provider e linha do tempo recente.
- O histórico não é inventado a partir do progresso importado do MAL: imports afetam os totais atuais, enquanto a linha do tempo usa apenas eventos reais de `watch_history`.
- Tela de detalhes para anime e mangá com sinopse, gêneros, nota, ranking, estúdio/autores, progresso e relações entre obras.
- Navegação entre prequelas, sequências e outras relações diretamente pelos detalhes.
- Agenda semanal funcional: AnimeSchedule quando há token e fallback automático pelo Jikan.
- Alertas automáticos de lançamentos para animes da biblioteca com antecedência de 10, 30 ou 60 minutos.
- Arquitetura de providers para serviços externos.
- Providers planejados para Crunchyroll, Netflix, Prime Video, Disney+ e Max.

## Executar

O script carrega automaticamente o MSVC e o Rust instalados no PC:

```powershell
cd "F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk"
npm install
npm run desktop:dev
```

Gerar o instalador Tauri/NSIS:

```powershell
npm run desktop:dist
```

Build apenas do frontend:

```powershell
npm run build
```

Executar a suíte automatizada uma vez:

```powershell
npm run test:run
```

Modo watch para desenvolvimento:

```powershell
npm test
```

Fallback Electron, caso seja necessário durante a migração:

```powershell
npm run electron:dev
```

Toolchains locais:

- Rust/Cargo: `D:\DevTools\Rust`
- Visual Studio Build Tools: `D:\VSBuildTools`
- Target/cache de build do Tauri: `D:\AnimeDeskTauriBuild\target`

## Dados

O modelo SQLite planejado contém:

- `media`
- `external_media_ids`
- `library_entries`
- `releases`
- `watch_history`
- `notifications`
- `settings`

No Tauri, a aplicação usa SQLite como persistência principal. No navegador, usa localStorage como fallback. Biblioteca e estados legados compatíveis são migrados automaticamente para SQLite quando encontrados. A tabela `settings` funciona como KV persistente para preferências, caches e last-sync sem exigir migration adicional.

## Importar do MyAnimeList

1. Exporte sua lista pelo MyAnimeList.
2. Abra **Integrações** no AnimeDesk.
3. Em **Trazer lista do MyAnimeList**, escolha o arquivo `.xml` ou `.xml.gz`.
4. Confira a prévia com quantidade de animes/mangás e confirme a importação.

A importação usa a chave composta `tipo + MAL ID`, então anime e mangá com o mesmo número de ID não colidem. Títulos já existentes recebem progresso/status/nota do arquivo, preservando metadados locais mais ricos quando disponíveis.

## Providers

### Ativo

**MyAnimeList**
- Busca de anime/mangá no runtime Tauri pelo backend Rust sem exigir login.
- Mantém MAL ID como identidade canônica atual.
- OAuth2 + PKCE oficial opcional na tela Integrações.
- Client ID é salvo localmente; access/refresh tokens ficam no Windows Credential Manager.
- Callback: `http://127.0.0.1:47821/oauth/mal/callback`.
- Importação autenticada das listas de anime e mangá.
- Nesta versão, a integração autenticada é somente leitura: MAL → AnimeDesk.

**Kitsu**
- Provider principal da Home/Descobrir.
- Trending, temporada, popularidade, top rated, current e upcoming.
- Categories para afinidade de gêneros.
- Mappings Kitsu → MAL ID.
- Cache local de descoberta como fallback temporário.

**Jikan**
- Provider complementar para detalhes/relations e modo web quando acessível.
- Não é mais dependência crítica da Home.
- Na rede testada em 05/10/2026, api.jikan.moe apresentou timeout.

**AnimeSchedule**
- Agenda semanal precisa de episódios legendados.
- Horário convertido para `America/Sao_Paulo`.
- Números de episódios e alertas.
- Opcional: sem token, a agenda usa automaticamente os horários de exibição do Jikan como fallback.

Copie `.env.example` para `.env` e configure `VITE_ANIMESCHEDULE_TOKEN` para ativar o provider principal de agenda.

### Planejados

**Crunchyroll**
- Watchlist.
- Histórico.
- Continue assistindo.
- Progresso.
- Inicialmente somente leitura.

**Netflix**
- Importação do histórico oficial CSV.
- Normalização dos títulos contra o catálogo local.

**Prime Video**
- Importação de histórico/exportação local.

**Disney+ / Max**
- Providers experimentais e isolados para não comprometer o restante do app.

## Arquitetura

```
UI React
   |
Stores / domínio
   |
+-- Catalog / Identity
|      +-- MyAnimeList direto
|      +-- Jikan (complementar)
|
+-- DiscoverProvider
|      +-- Kitsu
|      +-- cache local
|
+-- ScheduleProvider
|      +-- AnimeSchedule
|
+-- StreamingProvider
|      +-- Crunchyroll
|      +-- Netflix
|      +-- Prime Video
|
+-- Repository
       +-- SQLite
```

Cada serviço externo deve permanecer isolado. Se um endpoint privado mudar, apenas aquele provider deve falhar.

## Migrações SQLite

A migration inicial está congelada em `src-tauri/migrations/0001_initial.sql`. A migration `0002_add_studios.sql` adiciona `media.studios_json`. Não altere migrations já aplicadas: mudanças futuras do banco devem ser adicionadas como `0003_...`, `0004_...` etc. Isso evita incompatibilidade de checksum em instalações existentes.

## Próximas etapas

1. Testar o login OAuth real com um Client ID registrado no painel do MAL.
2. Implementar escrita opcional MAL (progresso/status/nota) com resolução explícita de conflitos.
3. Expandir testes para cache expirado, notification markers e conflitos runtime Tauri/SQLite.
4. Implementar importador de histórico Netflix.
5. Implementar CrunchyrollProvider somente leitura.
6. Evoluir a UI de mappings com histórico/auditoria e resolução assistida.
7. Evoluir estatísticas com filtros por período/provider e duração real quando providers externos fornecerem esse dado.
8. Polir ícone, CSP, identifier, instalador e atualização automática.
