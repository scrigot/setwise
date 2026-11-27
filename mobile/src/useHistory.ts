import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSnapshot, Snapshot } from './history';

export const endpoint = process.env.EXPO_PUBLIC_HISTORY_URL?.replace(/\/$/, '') || 'http://127.0.0.1:8795/history';
const cacheKey = 'setwise.finished-history.v1';
const empty: Snapshot = { source: 'Setwise', syncedAt: null, sessions: [] };

export function useHistory() {
  const [data, setData] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const requestRefresh = useRef<() => void>(() => {});
  const refresh = useCallback(() => requestRefresh.current(), []);

  useEffect(() => {
    let disposed = false;
    let received = false;
    let pending: AbortController | null = null;
    async function sync() {
      if (disposed || pending) return;
      const controller = new AbortController();
      pending = controller;
      setRefreshing(true);
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('History unavailable');
        const history = parseSnapshot(await response.json());
        if (disposed) return;
        received = true;
        setData(history);
        setError(null);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(history)).catch(() => {
          if (!disposed) setError('History is current. Offline storage is unavailable.');
        });
      } catch {
        if (!disposed) setError('Cannot reach Setwise. Check Tailscale and try again.');
      } finally {
        clearTimeout(timeout);
        pending = null;
        if (!disposed) setRefreshing(false);
      }
    }
    AsyncStorage.getItem(cacheKey).then(raw => {
      if (raw && !disposed && !received) setData(parseSnapshot(JSON.parse(raw)));
    }).catch(() => {});
    requestRefresh.current = sync;
    void sync();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void sync();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, 15000);
    return () => {
      disposed = true;
      pending?.abort();
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return { data, error, refreshing, refresh };
}
