package forge.api.servlet;

import com.fasterxml.jackson.databind.ObjectMapper;
import forge.game.*;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.api.game.*;
import forge.deck.Deck;
import forge.model.FModel;
import forge.util.storage.IStorage;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.*;

/**
 * REST endpoints for PvP lobby/waiting-room.
 *
 * POST /api/lobby/create    { playerName, format }          → { id, playerIndex:0, lobby }
 * GET  /api/lobby/{id}                                      → lobby state
 * POST /api/lobby/{id}/join { playerName }                  → { playerIndex:1, lobby }
 * POST /api/lobby/{id}/ready { playerIndex, deckName }      → { lobby, sessionId? }
 * POST /api/lobby/{id}/session { sessionId }                → { ok } (rematch: link new game)
 * DELETE /api/lobby/{id}                                    → { ok }
 */
public class LobbyServlet extends HttpServlet {

    private static final ObjectMapper mapper = new ObjectMapper();

    @Override
    protected void doOptions(HttpServletRequest req, HttpServletResponse resp) {
        cors(resp);
        resp.setStatus(HttpServletResponse.SC_OK);
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        cors(resp);
        resp.setContentType("application/json;charset=UTF-8");
        String uri = req.getRequestURI();

        if (uri.endsWith("/lobby/create")) {
            handleCreate(req, resp);
        } else if (uri.contains("/lobby/") && uri.endsWith("/join")) {
            String id = extractId(uri, "/join");
            handleJoin(id, req, resp);
        } else if (uri.contains("/lobby/") && uri.endsWith("/ready")) {
            String id = extractId(uri, "/ready");
            handleReady(id, req, resp);
        } else if (uri.contains("/lobby/") && uri.endsWith("/session")) {
            String id = extractId(uri, "/session");
            handleSetSession(id, req, resp);
        } else {
            resp.setStatus(404);
            mapper.writeValue(resp.getWriter(), error("Unknown endpoint: " + uri));
        }
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        cors(resp);
        resp.setContentType("application/json;charset=UTF-8");
        String uri = req.getRequestURI();
        // GET /api/lobby/{id}
        String id = uri.replaceAll(".*/lobby/", "").trim();
        if (id.isEmpty()) {
            resp.setStatus(400);
            mapper.writeValue(resp.getWriter(), error("Lobby ID required"));
            return;
        }
        Lobby lobby = LobbyManager.getInstance().get(id);
        if (lobby == null) {
            resp.setStatus(404);
            mapper.writeValue(resp.getWriter(), error("Lobby not found: " + id));
            return;
        }
        mapper.writeValue(resp.getWriter(), lobby.toMap());
    }

    @Override
    protected void doDelete(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        cors(resp);
        resp.setContentType("application/json;charset=UTF-8");
        String uri = req.getRequestURI();
        String id = uri.replaceAll(".*/lobby/", "").trim();
        LobbyManager.getInstance().remove(id);
        mapper.writeValue(resp.getWriter(), Map.of("ok", true));
    }

    // ── POST /api/lobby/create ───────────────────────────────────────────────

    private void handleCreate(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        Map<?, ?> body = readBody(req, resp);
        if (body == null) return;

        String playerName = getString(body, "playerName");
        String format = getString(body, "format");
        if (playerName == null || playerName.isBlank()) playerName = "Joueur 1";
        if (format == null || format.isBlank()) format = "Commander";

        Lobby lobby = LobbyManager.getInstance().create(format, playerName.trim());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", lobby.getId());
        result.put("playerIndex", 0);
        result.put("lobby", lobby.toMap());
        mapper.writeValue(resp.getWriter(), result);
    }

    // ── POST /api/lobby/{id}/join ────────────────────────────────────────────

    private void handleJoin(String id, HttpServletRequest req, HttpServletResponse resp) throws IOException {
        Lobby lobby = LobbyManager.getInstance().get(id);
        if (lobby == null) {
            resp.setStatus(404);
            mapper.writeValue(resp.getWriter(), error("Salle introuvable: " + id));
            return;
        }
        if (lobby.isFull()) {
            resp.setStatus(409);
            mapper.writeValue(resp.getWriter(), error("Salle pleine"));
            return;
        }
        if ("STARTED".equals(lobby.getStatus())) {
            resp.setStatus(409);
            mapper.writeValue(resp.getWriter(), error("La partie a déjà commencé"));
            return;
        }

        Map<?, ?> body = readBody(req, resp);
        if (body == null) return;
        String playerName = getString(body, "playerName");
        if (playerName == null || playerName.isBlank()) playerName = "Joueur 2";
        lobby.setPlayerName(1, playerName.trim());
        lobby.setStatus("FULL");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("playerIndex", 1);
        result.put("lobby", lobby.toMap());
        mapper.writeValue(resp.getWriter(), result);
    }

    // ── POST /api/lobby/{id}/ready ───────────────────────────────────────────

    private void handleReady(String id, HttpServletRequest req, HttpServletResponse resp) throws IOException {
        Lobby lobby = LobbyManager.getInstance().get(id);
        if (lobby == null) {
            resp.setStatus(404);
            mapper.writeValue(resp.getWriter(), error("Salle introuvable: " + id));
            return;
        }
        Map<?, ?> body = readBody(req, resp);
        if (body == null) return;

        int playerIndex = body.get("playerIndex") instanceof Number n ? n.intValue() : 0;
        String deckName = getString(body, "deckName");

        if (deckName == null || deckName.isBlank()) {
            resp.setStatus(400);
            mapper.writeValue(resp.getWriter(), error("deckName requis"));
            return;
        }
        if (playerIndex < 0 || playerIndex > 1) {
            resp.setStatus(400);
            mapper.writeValue(resp.getWriter(), error("playerIndex invalide"));
            return;
        }

        lobby.setPlayerDeck(playerIndex, deckName.trim());
        lobby.setReady(playerIndex, true);

        Map<String, Object> result = new LinkedHashMap<>();
        // Auto-start if both ready and lobby is not already started
        if (lobby.bothReady() && !"STARTED".equals(lobby.getStatus())) {
            try {
                String sessionId = autoStartGame(lobby);
                lobby.setSessionId(sessionId);
                lobby.setStatus("STARTED");
                result.put("started", true);
                result.put("sessionId", sessionId);
            } catch (Exception e) {
                System.err.println("[Lobby] autoStart error: " + e);
                result.put("startError", e.getMessage());
            }
        }
        result.put("lobby", lobby.toMap());
        mapper.writeValue(resp.getWriter(), result);
    }

    // ── POST /api/lobby/{id}/session ─────────────────────────────────────────
    // Called by player 0 after starting a rematch game to link the new sessionId.

    private void handleSetSession(String id, HttpServletRequest req, HttpServletResponse resp) throws IOException {
        Lobby lobby = LobbyManager.getInstance().get(id);
        if (lobby == null) {
            resp.setStatus(404);
            mapper.writeValue(resp.getWriter(), error("Salle introuvable: " + id));
            return;
        }
        Map<?, ?> body = readBody(req, resp);
        if (body == null) return;
        String sessionId = getString(body, "sessionId");
        String p1Name = getString(body, "player1Name");
        String p2Name = getString(body, "player2Name");
        if (sessionId == null || sessionId.isBlank()) {
            resp.setStatus(400);
            mapper.writeValue(resp.getWriter(), error("sessionId requis"));
            return;
        }
        lobby.setSessionId(sessionId);
        lobby.setStatus("STARTED");
        // Reset ready state for next game
        lobby.setReady(0, false);
        lobby.setReady(1, false);
        if (p1Name != null && !p1Name.isBlank()) lobby.setPlayerName(0, p1Name);
        if (p2Name != null && !p2Name.isBlank()) lobby.setPlayerName(1, p2Name);
        mapper.writeValue(resp.getWriter(), Map.of("ok", true, "lobby", lobby.toMap()));
    }

    // ── Game autostart ───────────────────────────────────────────────────────

    private String autoStartGame(Lobby lobby) throws Exception {
        String deck1Name = lobby.getPlayerDeck(0);
        String deck2Name = lobby.getPlayerDeck(1);
        String format = lobby.getFormat();
        String p1Name = lobby.getPlayerName(0);
        String p2Name = lobby.getPlayerName(1);

        boolean isCommander = !format.equalsIgnoreCase("Constructed");
        Deck d1 = findDeck(deck1Name);
        Deck d2 = findDeck(deck2Name);
        if (d1 == null) throw new IllegalArgumentException("Deck introuvable: " + deck1Name);
        if (d2 == null) throw new IllegalArgumentException("Deck introuvable: " + deck2Name);

        GameSession session = GameSessionManager.getInstance().create();
        session.setPvp(true);
        session.setPlayerName(0, p1Name);
        session.setPlayerName(1, p2Name);

        GameType gameType = isCommander ? GameType.Commander : GameType.Constructed;
        final Deck fd1 = d1, fd2 = d2;

        Thread gameThread = new Thread(() -> {
            try {
                LobbyPlayerApi lp1 = new LobbyPlayerApi(p1Name, session, 0);
                LobbyPlayerApi lp2 = new LobbyPlayerApi(p2Name, session, 1);
                RegisteredPlayer rp1 = isCommander ? RegisteredPlayer.forCommander(fd1) : new RegisteredPlayer(fd1);
                rp1.setPlayer(lp1);
                if (isCommander) rp1.setStartingLife(20);
                RegisteredPlayer rp2 = isCommander ? RegisteredPlayer.forCommander(fd2) : new RegisteredPlayer(fd2);
                rp2.setPlayer(lp2);
                if (isCommander) rp2.setStartingLife(20);
                GameRules rules = new GameRules(gameType);
                rules.setAppliedVariants(EnumSet.of(gameType));
                Match match = new Match(rules, List.of(rp1, rp2), "PvPLobby");
                Game game = match.createGame();
                session.setGame(game);
                match.startGame(game);
            } catch (PlayerControllerApi.GameAbortedException ignored) {
            } catch (Exception | Error e) {
                System.err.println("[Lobby] Game error: " + e);
                e.printStackTrace();
                session.setGameError(e.getClass().getSimpleName() + ": " + e.getMessage());
            } finally {
                session.setGameOver(true);
                session.receiveDecision(Map.of("choice", "pass"));
            }
        }, "GameSession-" + session.getId());
        gameThread.setDaemon(true);
        session.setGameThread(gameThread);
        gameThread.start();

        return session.getId();
    }

    private Deck findDeck(String name) {
        Deck d = FModel.getDecks().getCommander().get(name);
        if (d == null) d = FModel.getDecks().getConstructed().get(name);
        return d;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private String extractId(String uri, String suffix) {
        String withoutSuffix = uri.substring(0, uri.length() - suffix.length());
        int lastSlash = withoutSuffix.lastIndexOf('/');
        return withoutSuffix.substring(lastSlash + 1).toUpperCase();
    }

    private Map<?, ?> readBody(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        try {
            return mapper.readValue(req.getInputStream(), Map.class);
        } catch (Exception e) {
            resp.setStatus(400);
            mapper.writeValue(resp.getWriter(), error("JSON invalide"));
            return null;
        }
    }

    private void cors(HttpServletResponse resp) {
        resp.setHeader("Access-Control-Allow-Origin", "*");
        resp.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        resp.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    private static String getString(Map<?, ?> map, String key) {
        Object val = map.get(key);
        return val instanceof String ? (String) val : null;
    }

    private static Map<String, String> error(String message) {
        return Map.of("error", message);
    }
}
