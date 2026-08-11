/**
 * The `⋯` menu on somebody's comment: Report, Block, or Delete if it is yours.
 *
 * ONE IMPLEMENTATION, TWO SCREENS. The thread and the permalink both show other
 * people's writing, and both need the same two taps to Report or Block — that
 * is the bar App Store guideline 1.2 sets for user-generated content. They had
 * one implementation between them: the thread's. The permalink's `⋯` called
 * `openThread`, so a comment opened on its own screen offered no way to report
 * it at all, which is the screen a shared link lands on.
 *
 * The hook owns the sheets and the confirmations; the caller says only what to
 * do with a comment once it is gone, because that differs — a list removes a
 * row, a permalink has nowhere to stay.
 */
import { useState } from 'react';
import { Alert } from 'react-native';

import { ApiError } from '@/api';
import { blockProfile, deleteComment, reportComment, type Comment } from '@/community-comments';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { commentErrorKey, REPORT_REASONS, reportReasonKey, type ReportReason } from '@/pure';

function errorMessage(e: unknown): string {
  return t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown'));
}

export function useCommentModeration({
  myId,
  onDeleted,
  onBlocked,
}: {
  myId: string | null;
  /** The comment is gone from the server. Remove it from whatever holds it. */
  onDeleted: (c: Comment) => void;
  /** Every comment by this author is gone. Both directions of any follow too. */
  onBlocked: (c: Comment) => void;
}) {
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [reportFor, setReportFor] = useState<Comment | null>(null);

  const confirmDelete = (c: Comment) => {
    Alert.alert(t('community.comments.deleteTitle'), t('community.comments.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('community.comments.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteComment(c.id);
              onDeleted(c);
            } catch (e) {
              Alert.alert(t('community.comments.failedTitle'), errorMessage(e));
            }
          })();
        },
      },
    ]);
  };

  const sendReport = (c: Comment, reason: ReportReason) => {
    void (async () => {
      try {
        await reportComment(c.id, reason);
        // 202 — FILED, not judged. The confirmation says so on purpose: the
        // queue is a person, and promising an outcome would be a lie.
        Alert.alert(t('community.report.sentTitle'), t('community.report.sentBody'));
      } catch (e) {
        Alert.alert(t('community.report.failedTitle'), errorMessage(e));
      }
    })();
  };

  const confirmBlock = (c: Comment) => {
    // Confirmed first, because it is not reversible from here and it drops any
    // follow between the two accounts in both directions.
    Alert.alert(t('community.block.title', { handle: c.author.handle }), t('community.block.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('community.block.confirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await blockProfile(c.author.id);
              onBlocked(c);
            } catch (e) {
              Alert.alert(t('community.block.failedTitle'), errorMessage(e));
            }
          })();
        },
      },
    ]);
  };

  /**
   * Your own comment offers Delete and nothing else — reporting or blocking
   * yourself is not a feature, and the server would refuse the block anyway.
   */
  const menuActions = (c: Comment): SheetAction[] => {
    if (myId !== null && c.author.id === myId) {
      return [
        {
          text: t('community.comments.delete'),
          icon: 'trash-outline',
          destructive: true,
          onPress: () => confirmDelete(c),
        },
      ];
    }
    return [
      { text: t('community.comments.report'), icon: 'flag-outline', onPress: () => setReportFor(c) },
      {
        text: t('community.comments.block'),
        icon: 'ban-outline',
        destructive: true,
        onPress: () => confirmBlock(c),
      },
    ];
  };

  const reportActions = (c: Comment): SheetAction[] =>
    REPORT_REASONS.map((reason) => ({
      text: t(reportReasonKey(reason)),
      icon: 'alert-circle-outline' as const,
      onPress: () => sendReport(c, reason),
    }));

  return {
    /** Call from the row's `⋯`. */
    openMenu: (c: Comment) => {
      tapSelection();
      setMenuFor(c);
    },
    /** Render once, anywhere inside the screen. */
    sheets: (
      <>
        <ActionSheet
          visible={menuFor != null}
          actions={menuFor ? menuActions(menuFor) : []}
          onClose={() => setMenuFor(null)}
        />
        <ActionSheet
          visible={reportFor != null}
          title={t('community.report.title')}
          actions={reportFor ? reportActions(reportFor) : []}
          onClose={() => setReportFor(null)}
        />
      </>
    ),
  };
}
