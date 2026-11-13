import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { api } from '@/lib/api';
import { callPush } from '@/lib/calls';
import { answerAction, declineAction, ringFromPush, stopFromPush } from '@/lib/call-system';

/**
 * Android's call pushes with the app in the background or closed: Firebase's data message `call` rings the phone
 * (CallKeep's ConnectionService and the incoming call notice), `call_ended` stops it; the notice's Decline ends the
 * call without opening the app. Defined when the app's bundle loads (`index.ts`), as expo-task-manager runs it without
 * the screens. With the app open, its own presence check rings the call panel instead, so the task leaves it alone.
 * iPhones need none of this: VoIP pushes are reported to CallKit natively (plugins/with-udozo-calls.js).
 */
export const callTask = 'udozo-calls';

/** Answers waiting for the call panel: Answer on the notice opened the app, which hands the call over once it runs. */
type Waiting = (callId: string) => void;
let waiting: Waiting | null = null;
let pendingAnswer: string | null = null;

export function onAnswerRequested(listener: Waiting) {
  waiting = listener;
  if (pendingAnswer) {
    const callId = pendingAnswer;
    pendingAnswer = null;
    listener(callId);
  }
  return () => {
    if (waiting === listener) waiting = null;
  };
}

export function requestAnswer(callId: string) {
  if (waiting) waiting(callId);
  else pendingAnswer = callId;
}

/** A tapped call notice: Answer opens the app to answer, Decline ends the call. True when it was a call's. */
export async function handleCallResponse(response: Notifications.NotificationResponse) {
  const push = callPush(response.notification.request.content.data);
  if (!push || push.kind !== 'call') return false;
  if (response.actionIdentifier === declineAction) {
    await stopFromPush(push.callId);
    await api(`/v1/classifieds/calls/${push.callId}/end`, { body: {} }).catch(() => undefined);
  } else if (response.actionIdentifier === answerAction || response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    requestAnswer(push.callId);
  }
  return true;
}

if (Platform.OS === 'android') {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(callTask, async ({ data, error }) => {
    if (error || !data) return Notifications.BackgroundNotificationTaskResult.NoData;
    if ('actionIdentifier' in data) {
      await handleCallResponse(data);
      return Notifications.BackgroundNotificationTaskResult.NewData;
    }
    const push = callPush(data.data);
    if (!push) return Notifications.BackgroundNotificationTaskResult.NoData;
    if (push.kind === 'call_ended') await stopFromPush(push.callId);
    else if (AppState.currentState !== 'active') await ringFromPush(push);
    return Notifications.BackgroundNotificationTaskResult.NewData;
  });
  Notifications.registerTaskAsync(callTask).catch(() => undefined);
}
