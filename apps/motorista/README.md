# App do Motorista — Bus Inteligente (goal 02)

PWA vanilla JS (sem build) servida pelo backend em `/motorista/`. Fala **apenas com o backend** (mesma origem): auth e dados via proxy `/dx/*`, posições via `/ingest/position` — a mesma topologia do deploy em produção.

## Fluxo
1. **Login** (RF-M1): e-mail + PIN → Directus `/auth/login` via proxy. Sessão longa: `refresh_token` no `localStorage`, renovação automática do `access_token`. Reabrir o app com turno ativo **retoma o turno** direto no painel.
2. **Iniciar turno** (RF-M2): seleciona veículo + linha/sentido → cria `driver_assignments` ativo (a validação `driver_id == $CURRENT_USER` é imposta pelo Directus).
3. **Transmissão** (RF-M3/M9): `watchPosition` de alta precisão. Frequência **adaptativa**: em movimento a cada 5s; parado >30s, a cada 15s (bateria/dados). Wake Lock mantém a tela ligada durante o turno.
4. **Buffer offline** (RF-M5): toda posição entra numa **fila IndexedDB**; um flusher (5s) envia em lote de até 100 e só remove após confirmação do servidor. Sem rede, a fila cresce; ao reconectar, tudo sobe em ordem com o `recorded_at` original.
5. **Painel** (RF-M4): banner Transmitindo ✅ / Sem rede ⚠️ (com contagem do buffer), velocidade, próxima parada (calculada do trajeto), avisos da operação (RF-M7, poll 60s).
6. **Encerrar** (RF-M6): drena o buffer, finaliza o `driver_assignments`, para GPS/flusher/wake lock.

## Testar
```bash
cd backend && npm start
# abrir http://localhost:8060/motorista/
# login de teste: motorista.teste@bus.candidatosinteligentes.com.br / PIN em config/.env (DRIVER_TEST_PASSWORD)
```
- Sem GPS (desktop): o app oferece **GPS simulado** que percorre o trajeto da viagem (modo demonstração).
- Simular queda de rede no console: `window.__simulateOffline = true` (e `false` para voltar).

## Limitação conhecida (documentada por honestidade)
Navegadores móveis **suspendem `watchPosition` com a tela bloqueada**. A mitigação MVP é o **Wake Lock** (tela permanece ligada durante o turno — padrão em tablets embarcados de frota). Para transmissão com tela realmente bloqueada/app em segundo plano, empacotar com **Capacitor** (Android, plugin de background geolocation) — estrutura do app já é compatível; fica como fase 2 do app (nota no goal 02).
