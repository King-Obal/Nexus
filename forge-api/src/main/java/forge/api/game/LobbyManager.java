package forge.api.game;

import java.util.Collection;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;

public class LobbyManager {

    private static final LobbyManager INSTANCE = new LobbyManager();
    private final ConcurrentHashMap<String, Lobby> lobbies = new ConcurrentHashMap<>();
    private final Random rng = new Random();
    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

    private LobbyManager() {}

    public static LobbyManager getInstance() { return INSTANCE; }

    public Lobby create(String format, String player1Name) {
        String id;
        do {
            StringBuilder sb = new StringBuilder(6);
            for (int i = 0; i < 6; i++) sb.append(CHARS.charAt(rng.nextInt(CHARS.length())));
            id = sb.toString();
        } while (lobbies.containsKey(id));
        Lobby lobby = new Lobby(id, format, player1Name);
        lobbies.put(id, lobby);
        return lobby;
    }

    public Lobby get(String id) {
        return id == null ? null : lobbies.get(id.toUpperCase());
    }

    public void remove(String id) {
        if (id != null) lobbies.remove(id.toUpperCase());
    }

    public Collection<Lobby> all() {
        return lobbies.values();
    }

    public void pruneInactive(long maxIdleMs) {
        long now = System.currentTimeMillis();
        lobbies.entrySet().removeIf(e -> (now - e.getValue().getLastActivity()) > maxIdleMs);
    }
}
