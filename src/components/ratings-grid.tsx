/**
 * Every episode you rated, as a grid: seasons across, episodes down.
 *
 * WHY A GRID AND NOT ONLY A LINE. A line has to decide what to do about the
 * episodes you never rated — connect through them and it invents scores, break
 * at them and a sparse season becomes confetti. A grid does not have the
 * problem: an unrated episode is an empty cell, and an empty cell explains
 * itself. For a library like this one — a hundred and sixty-odd ratings spread
 * over twenty-eight shows — that is most of the picture.
 *
 * COLOUR IS THE READING, the number is the confirmation. Five bands for five
 * stars (`ratingBand`), so a season that fell apart is visible before a single
 * figure has been read.
 *
 * The maths — averages that ignore unrated episodes, which season a cell
 * belongs to, which band a score falls in — is in pure.ts and tested there.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ratingBand, ratingGrid } from '@/pure';
import { colors } from '@/theme';
import { t } from '@/i18n';

/**
 * Red through green in five steps.
 *
 * Deliberately NOT the app's yellow/green tokens: those two say "act" and
 * "confirm" everywhere else in the app, and a cell is neither — it is a
 * measurement. Borrowed from the same red-to-green vocabulary every ratings
 * table uses, because that is the one thing a reader already knows.
 */
const BANDS = ['#7F1D1D', '#9A3412', '#A16207', '#3F6212', '#15803D'];
const TEXT_ON_BAND = '#FFFFFF';

const CELL = 44;
const GAP = 4;
const LABEL_W = 34;
/**
 * The season header's own height, and the gap under the averages row.
 *
 * THE LABEL COLUMN HAS TO ACCOUNT FOR BOTH. It lives outside the horizontal
 * scroller so the episode numbers stay put — which means nothing aligns it
 * automatically, and leaving these two out slid every `E` label up by about
 * half a cell. Correct-looking, and wrong on every row.
 */
const HEADER_H = 23;
const AVG_GAP = GAP * 2;

export type RatingsGridProps = {
  episodes: { season: number; episode: number }[];
  ratings: Map<string, number>;
};

export function RatingsGrid({ episodes, ratings }: RatingsGridProps) {
  const g = ratingGrid(episodes, (s, e) => ratings.get(`${s}-${e}`) ?? null);
  if (g.rated === 0) return null;

  const label = (season: number) =>
    season === 0 ? t('show.ratingsGrid.specials') : `S${season}`;

  return (
    <View style={s.wrap}>
      {/* The row labels sit OUTSIDE the horizontal scroller so they stay put
          while the seasons move — a grid whose episode numbers scroll away is
          a grid you have to count. */}
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: LABEL_W }}>
          <View style={{ height: HEADER_H }} />
          <View style={[s.headCell, { height: CELL + AVG_GAP }]}>
            <Text style={s.avgLabel}>{t('show.ratingsGrid.avg')}</Text>
          </View>
          {g.rows.map((ep) => (
            <View key={ep} style={[s.headCell, { height: CELL + GAP }]}>
              <Text style={s.rowLabel}>{`E${ep}`}</Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={{ flexDirection: 'row' }}>
              {g.seasons.map((season) => (
                <Text key={season} style={[s.colLabel, { width: CELL, height: HEADER_H, marginRight: GAP }]}>
                  {label(season)}
                </Text>
              ))}
            </View>

            {/* the season averages, on their own row above the episodes */}
            <View style={{ flexDirection: 'row', marginBottom: AVG_GAP }}>
              {g.seasons.map((season) => {
                const avg = g.seasonAverage.get(season) ?? null;
                return (
                  <View
                    key={season}
                    style={[
                      s.cell,
                      { marginRight: GAP },
                      avg == null
                        ? s.empty
                        : { backgroundColor: BANDS[ratingBand(avg)], borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
                    ]}>
                    {avg != null && <Text style={s.cellText}>{avg.toFixed(1)}</Text>}
                  </View>
                );
              })}
            </View>

            {g.rows.map((ep) => (
              <View key={ep} style={{ flexDirection: 'row', marginBottom: GAP }}>
                {g.seasons.map((season) => {
                  const v = g.cell(season, ep);
                  const exists = episodes.some((e) => e.season === season && e.episode === ep);
                  return (
                    <View
                      key={season}
                      style={[
                        s.cell,
                        { marginRight: GAP },
                        // three states, not two: a season that ended earlier has
                        // NO episode here, which is a different thing from one
                        // you simply never rated
                        !exists ? s.absent : v == null ? s.empty : { backgroundColor: BANDS[ratingBand(v)] },
                      ]}>
                      {v != null && <Text style={s.cellText}>{v}</Text>}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingBottom: 12 },
  headCell: { alignItems: 'flex-start', justifyContent: 'center' },
  rowLabel: { color: colors.faint, fontSize: 11, fontWeight: '700' },
  avgLabel: { color: colors.dim, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  colLabel: { color: colors.dim, fontSize: 11, fontWeight: '800', textAlign: 'center', paddingBottom: 6 },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { color: TEXT_ON_BAND, fontSize: 14, fontWeight: '800' },
  /** Rated by nobody: present, and plainly blank. */
  empty: { backgroundColor: 'rgba(255,255,255,0.06)' },
  /** Not an episode at all. Fainter still, so the eye skips it. */
  absent: { backgroundColor: 'transparent' },
});
