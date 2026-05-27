package forge.api.game;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A PvP lobby waiting room.
 * Status: WAITING (1 player) → FULL (2 players) → STARTED (game launched)
 */
public class Lobby {

    private final String id;
    private String format;
    private final String[] names = new String[2];
    private final String[] decks = new String[2];
    private final boolean[] ready = new boolean[2];
    private String status; // WAITING | FULL | STARTED
    private String sessionId;
    private volatile long lastActivity;

    public Lobby(String id, String format, String player1Name) {
        this.id = id;
        this.format = format != null ? format : "Commander";
        this.names[0] = player1Name;
        this.status = "WAITING";
        this.lastActivity = System.currentTimeMillis();
    }

    public String getId() { return id; }

    public String getFormat() { return format; }
    public void setFormat(String f) { this.format = f; touch(); }

    public String getPlayerName(int i) { return names[i]; }
    public void setPlayerName(int i, String n) { names[i] = n; touch(); }

    public String getPlayerDeck(int i) { return decks[i]; }
    public void setPlayerDeck(int i, String d) { decks[i] = d; touch(); }

    public boolean isReady(int i) { return ready[i]; }
    public void setReady(int i, boolean r) { ready[i] = r; touch(); }

    public String getStatus() { return status; }
    public void setStatus(String s) { this.status = s; touch(); }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sid) { this.sessionId = sid; touch(); }

    public long getLastActivity() { return lastActivity; }
    public void touch() { lastActivity = System.currentTimeMillis(); }

    public boolean isFull() { return names[1] != null; }
    public boolean bothReady() { return ready[0] && ready[1]; }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("format", format);
        m.put("status", status);
        if (sessionId != null) m.put("sessionId", sessionId);

        List<Object> players = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            if (names[i] == null) {
                players.add(null);
            } else {
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("name", names[i]);
                p.put("deck", decks[i]);
                p.put("ready", ready[i]);
                players.add(p);
            }
        }
        m.put("players", players);
        return m;
    }
}
