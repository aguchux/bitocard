import { View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { answerBlocks, type AnswerRun } from '@/lib/answer-html';
import { openLink } from '@/lib/navigate';

/**
 * Anjio's answer as text: paragraphs, bold, italics, line breaks, lists and links (opened in the app where it has the
 * page, else on udozo.com), from `answerBlocks`. Never a web view: the answer is only ever words.
 */
export function AnswerText({ html }: { html: string }) {
  const theme = useTheme();
  const runs = (items: AnswerRun[]) =>
    items.map((run, index) =>
      'br' in run ? (
        '\n'
      ) : (
        <ThemedText
          key={index}
          accessibilityRole={run.href ? 'link' : undefined}
          onPress={run.href ? () => openLink(run.href!) : undefined}
          style={[run.bold && { fontFamily: inter.bold }, run.italic && { fontStyle: 'italic' }, run.href ? { color: theme.link, fontFamily: inter.semibold, textDecorationLine: 'underline' } : null]}>
          {run.text}
        </ThemedText>
      ),
    );
  return (
    <View style={{ gap: Spacing.two }}>
      {answerBlocks(html).map((block, index) =>
        block.kind === 'p' ? (
          <ThemedText key={index}>{runs(block.runs)}</ThemedText>
        ) : (
          <View key={index} style={{ gap: 2 }}>
            {block.items.map((item, at) => (
              <ThemedText key={at}>
                {block.ordered ? `${at + 1}. ` : '• '}
                {runs(item)}
              </ThemedText>
            ))}
          </View>
        ),
      )}
    </View>
  );
}
