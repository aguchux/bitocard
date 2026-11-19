import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

import { Button, Card, Chip, Line, Notice, Page, T, inter, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { labelPoint, landingRotation, spinValue, wedgePath } from '@/lib/spin';
import type { Spin, SpinExchange, SpinExchangePreview, SpinRewards } from '@/lib/types';

const size = 280;
const r = size / 2;
const turnMs = 4500;

const blocked: Record<NonNullable<SpinRewards['reason']>, string> = {
  not_enabled: 'Spin and win is not open in your country yet.',
  email_not_verified: 'Confirm your email to spin.',
  claimed_elsewhere: 'Spin and win was already used with this email.',
};

/**
 * Spin and win: the wheel shows only values that can be won, and the server decides each spin before the wheel turns
 * to it. What is won is held in US dollars and moved into a wallet (the country's currency or US dollars) when the
 * customer chooses, its amount shown first.
 */
export default function SpinScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const state = useQuery({ queryKey: ['spins'], queryFn: () => api<SpinRewards>('/v1/store/spins') });
  const [turn] = useState(() => new Animated.Value(0));
  const at = useRef(0);
  const [won, setWon] = useState<string | null>(null);
  const [turning, setTurning] = useState(false);
  const [currency, setCurrency] = useState<string | null>(null);
  const [preview, setPreview] = useState<SpinExchangePreview | null>(null);
  const [still, setStill] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
  }, []);

  const count = state.data?.segments.length ?? 12;
  const spin = useMutation({
    mutationFn: () => api<Spin>('/v1/store/spins', { body: {} }),
    onMutate: () => setWon(null),
    onSuccess: result => {
      const next = landingRotation(at.current, result.segment, count);
      at.current = next;
      setTurning(true);
      Animated.timing(turn, { toValue: next, duration: still ? 0 : turnMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
        setTurning(false);
        setWon(result.usd);
        AccessibilityInfo.announceForAccessibility(`You won ${spinValue(result.usd)}`);
        void queries.invalidateQueries({ queryKey: ['spins'] });
      });
    },
  });
  const exchange = useMutation({
    mutationFn: (confirm: boolean): Promise<SpinExchange | SpinExchangePreview> =>
      confirm && preview
        ? api<SpinExchange>('/v1/store/spins/exchange', { body: { currency: preview.currency, expected_amount: preview.amount } })
        : api<SpinExchangePreview>('/v1/store/spins/exchange', { body: { currency: currency ?? state.data?.rewards.exchange_currencies[0], preview: true } }),
    onSuccess: (result, confirm) => {
      if (result.object === 'spin_exchange_preview') return setPreview(result);
      setPreview(null);
      void queries.invalidateQueries({ queryKey: ['spins'] });
      void queries.invalidateQueries({ queryKey: ['wallet'] });
    },
  });

  const data = state.data;
  if (!data) return <Page>{state.isError ? <Notice tone="bad">{state.error instanceof ApiError ? state.error.message : 'Spin and win could not be read.'}</Notice> : <T muted>Loading…</T>}</Page>;
  const allowance = data.allowance;
  const canSpin = data.enabled && !allowance?.finished && (allowance ? allowance.today_left > 0 : true);
  const rotate = turn.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  const rewards = Number(data.rewards.usd);
  const choice = currency ?? data.rewards.exchange_currencies[0] ?? null;

  return (
    <Page>
      <T muted>Free spins every day. What you win goes into your wallet when you choose.</T>
      {data.reason ? <Notice>{blocked[data.reason]}</Notice> : null}

      <View style={styles.stage} accessible accessibilityLabel={`Prize wheel with ${count} prizes`}>
        <View style={[styles.pointer, { borderTopColor: theme.pink }]} />
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Svg width={size} height={size}>
            {data.segments.map(segment => {
              const label = labelPoint(segment.index, count, r);
              return (
                <G key={segment.index}>
                  <Path d={wedgePath(segment.index, count, r)} fill={segment.index % 2 ? theme.pink : '#070f4c'} stroke="#ffffff" strokeWidth={2} />
                  <SvgText x={label.x} y={label.y} fill="#ffffff" fontSize={15} fontFamily={inter.bold} textAnchor="middle" alignmentBaseline="middle" rotation={label.rotate} origin={`${label.x}, ${label.y}`}>
                    {spinValue(segment.usd)}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
        </Animated.View>
      </View>

      {won ? (
        <T kind="title" color={theme.good} style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
          You won {spinValue(won)}
        </T>
      ) : null}
      {spin.isError ? <Notice tone="bad">{spin.error instanceof ApiError ? spin.error.message : 'The spin did not go through. Try again.'}</Notice> : null}
      <Button label={turning ? 'Spinning…' : 'Spin'} onPress={() => spin.mutate()} busy={spin.isPending} disabled={!canSpin || turning} />
      {allowance ? (
        <Card>
          <Line label="Won so far" value={`$${allowance.won_usd}`} strong />
          <Line label="Spins left today" value={`${allowance.today_left} of ${allowance.daily_limit}`} />
          {allowance.finished ? <T kind="small" muted>You have had all your spins. Thank you for playing.</T> : null}
          {!allowance.finished && allowance.today_left === 0 && allowance.next_spin_at ? <T kind="small" muted>Your next spin is from {new Date(allowance.next_spin_at).toLocaleString()}.</T> : null}
        </Card>
      ) : null}

      {rewards > 0 ? (
        <Card>
          <T kind="heading">Your rewards: ${data.rewards.usd}</T>
          <T kind="small" muted>
            Move them into a wallet to spend. They are never paid out to a bank.
          </T>
          <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Into which wallet">
            {data.rewards.exchange_currencies.map(code => (
              <Chip
                key={code}
                label={code === 'USD' ? 'US dollars' : code}
                selected={code === choice}
                onPress={() => {
                  setCurrency(code);
                  setPreview(null);
                }}
              />
            ))}
          </View>
          {preview ? (
            <>
              <Line label="Into your wallet" value={formatMoney(preview.amount, preview.currency)} strong />
              <Button label="Move to my wallet" onPress={() => exchange.mutate(true)} busy={exchange.isPending} />
            </>
          ) : (
            <Button kind="secondary" label="See what you get" onPress={() => exchange.mutate(false)} busy={exchange.isPending} disabled={!choice} />
          )}
          {exchange.isError ? <Notice tone="bad">{exchange.error instanceof ApiError ? exchange.error.message : 'That did not go through.'}</Notice> : null}
        </Card>
      ) : null}
      {exchange.isSuccess && !preview && exchange.data.object === 'spin_exchange' ? <Notice tone="good">{formatMoney(exchange.data.amount, exchange.data.currency)} is in your wallet.</Notice> : null}

      {data.recent.length ? (
        <Card>
          <T kind="label">Recent wins</T>
          {data.recent.slice(0, 5).map(win => (
            <Line key={win.id} label={new Date(win.created_at).toLocaleDateString()} value={spinValue(win.usd)} />
          ))}
        </Card>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', paddingTop: 18 },
  pointer: { position: 'absolute', top: 0, zIndex: 1, width: 0, height: 0, borderLeftWidth: 14, borderRightWidth: 14, borderTopWidth: 24, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
