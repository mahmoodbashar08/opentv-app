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
 * The palette every episode-ratings heatmap already uses, sampled from one
 * rather than invented: purple for the episode that broke the show, then red,
 * orange, yellow, green, dark green, and blue for the one nobody forgets.
 *
 * Deliberately NOT the app's yellow and green tokens. Those two mean "act" and
 * "confirm" everywhere else here, and a cell is neither — it is a
 * measurement — and a reader arriving from any of the other ratings tools
 * already knows what these colours say.
 *
 * Index matches `ratingBand`, worst first.
 */
const BANDS = ['#5D3B71', '#D65745', '#E7A03C', '#EED15C', '#58B16B', '#33683F', '#4D9FEB'];
/** Yellow is bright enough that white on it is unreadable. */
const INK = ['#FFFFFF', '#FFFFFF', '#20160A', '#20160A', '#0C1F11', '#FFFFFF', '#08192B'];

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
  /**
   * Whose numbers these are. A community average is 3.4, not three stars, so
   * the cells print a decimal — and the caller says so rather than this
   * guessing from the values, because a library of whole ratings would look
   * identical.
   */
  decimal?: boolean;
  /** Shown above the grid when it is not your own ratings being drawn. */
  note?: string;
  /**
   * Drawn INSIDE a share card rather than on the page.
   *
   * The cells were always fixed hex, but the labels around them read the
   * theme — so on a light theme the row and column headings would vanish into
   * the card's own black. A picture does not have a theme; see the note at the
   * top of `ratings-share-card.tsx`.
   */
  onPicture?: boolean;
  /**
   * Split into side-by-side blocks once the grid is taller than this.
   *
   * WHY IT EXISTS: a single season of sixty-four episodes is a column three
   * thousand points tall, and iOS simply refuses to photograph a view that
   * size — `drawViewHierarchyInRect was not successful`. Chunking the ROWS
   * into columns of blocks, the way a newspaper runs a long story, keeps every
   * season in its own column and brings the height back under the limit. It is
   * also a better picture: nobody wants a sixty-four cell ribbon.
   *
   * Only the share card passes it. On the page the grid scrolls, so height
   * costs nothing and the ordinary single block stands.
   */
  maxRows?: boolean;
};

export function RatingsGrid({ episodes, ratings, decimal, note, onPicture, maxRows }: RatingsGridProps) {
  const label1 = onPicture ? '#A7A7AE' : colors.dim;
  const label2 = onPicture ? '#6B6B72' : colors.faint;
  const blank = onPicture ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.06)';
  const g = ratingGrid(episodes, (s, e) => ratings.get(`${s}-${e}`) ?? null);
  /*
   * NOTHING TO DRAW IS SAID, NOT LEFT BLANK. This returned null, and on the
   * ratings page that is a whole tab of black — which is what a show nobody
   * has rated actually looked like.
   */
  if (g.rated === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.emptyText}>{t('show.ratingsGrid.empty')}</Text>
      </View>
    );
  }

  /*
   * SPECIALS ONLY WHEN THEY WERE RATED. A show with a specials season but no
   * ratings in it got an empty column headed "Sp" — a whole column of nothing,
   * on the one screen whose job is showing what IS there. Every other season
   * stays even when empty, because dropping a numbered season would renumber
   * the columns to its right and quietly lie about which is which.
   */
  const seasons = g.seasons.filter(
    (season) => season !== 0 || (g.seasonAverage.get(0) ?? null) != null,
  );

  /*
   * THE ROWS BELONG TO THE COLUMNS THAT ARE SHOWN.
   *
   * `g.rows` counts to the longest season in the whole show — and a specials
   * season is often enormous. Hiding the specials COLUMN while leaving its
   * length in the row count gave Avatar thirty-three rows for twenty-one
   * episodes, a dozen of them empty and labelled for episodes that do not
   * exist. The grid is only as tall as what it draws.
   */
  const maxEpisode = episodes.reduce(
    (n, e) => (seasons.includes(e.season) ? Math.max(n, e.episode) : n),
    0,
  );
  const rows = Array.from({ length: maxEpisode }, (_, i) => i + 1);

  const label = (season: number) =>
    season === 0 ? t('show.ratingsGrid.specials') : `S${season}`;

  /*
   * HOW MANY BLOCKS, WORKED OUT RATHER THAN GUESSED.
   *
   * A fixed row limit was the wrong shape of answer: sixty-four episodes of
   * one season split into three blocks is still a ribbon, because each block
   * is one column wide. What matters is the ASPECT — a block is
   * `LABEL_W + seasons × cell` wide and `rowsPerBlock × cell` tall, so the
   * number of blocks that makes those two roughly equal is the square root of
   * the ratio between them.
   *
   * Sixty-four episodes of one season give six blocks of eleven; Game of
   * Thrones, ten episodes across seven seasons, gives one and is left exactly
   * as it was.
   *
   * THE CAP IS HIGH ON PURPOSE. Eight blocks looked like plenty until
   * Detective Conan — one season of 1208 episodes — hit it and came out 151
   * rows tall, which is the same unphotographable ribbon this was written to
   * prevent. Left to the square root it asks for twenty-six blocks and lands
   * near square; thirty is a ceiling that nothing real reaches rather than a
   * shape decision.
   */
  /**
   * A SHORT SEASON IS NEVER SPLIT. Ten episodes cut into two columns of five
   * looks like a mistake — the card already has a header tall enough to carry
   * it, and balancing something that was never out of balance just makes the
   * reader's eye jump. Splitting starts where a single column genuinely runs
   * long.
   */
  const SPLIT_ABOVE = 14;
  const blockW = LABEL_W + seasons.length * (CELL + GAP);
  const wanted =
    maxRows && rows.length > SPLIT_ABOVE
      ? Math.max(1, Math.min(30, Math.round(Math.sqrt((rows.length * (CELL + GAP)) / blockW))))
      : 1;
  const size = Math.ceil(rows.length / wanted);
  const chunks: number[][] = [];
  for (let i = 0; i < rows.length; i += size || 1) chunks.push(rows.slice(i, i + (size || 1)));

  const block = (blockRows: number[], key: number) => (
    <View key={key} style={{ flexDirection: 'row' }}>
        <View style={{ width: LABEL_W }}>
          <View style={{ height: HEADER_H }} />
          <View style={[s.headCell, { height: CELL + AVG_GAP }]}>
            <Text style={[s.avgLabel, { color: label1 }]}>{t('show.ratingsGrid.avg')}</Text>
          </View>
          {blockRows.map((ep) => (
            <View key={ep} style={[s.headCell, { height: CELL + GAP }]}>
              <Text style={[s.rowLabel, { color: label2 }]}>{`E${ep}`}</Text>
            </View>
          ))}
        </View>

        {/* A PICTURE CANNOT SCROLL, so on the share card the seasons are laid
            out flat and the card is as wide as it needs to be. On the page the
            scroller stays, because a phone is narrower than eight seasons. */}
        <Scroller horizontal={!maxRows}>
          <View>
            <View style={{ flexDirection: 'row' }}>
              {seasons.map((season) => (
                <Text
                  key={season}
                  style={[s.colLabel, { width: CELL, height: HEADER_H, marginRight: GAP, color: label1 }]}>
                  {label(season)}
                </Text>
              ))}
            </View>

            {/* the season averages, on their own row above the episodes */}
            <View style={{ flexDirection: 'row', marginBottom: AVG_GAP }}>
              {seasons.map((season) => {
                const avg = g.seasonAverage.get(season) ?? null;
                return (
                  <View
                    key={season}
                    style={[
                      s.cell,
                      { marginRight: GAP },
                      avg == null
                        ? { backgroundColor: blank }
                        : { backgroundColor: BANDS[ratingBand(avg)], borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
                    ]}>
                    {avg != null && (
                      <Text style={[s.cellText, { color: INK[ratingBand(avg)] }]}>{avg.toFixed(1)}</Text>
                    )}
                  </View>
                );
              })}
            </View>

            {blockRows.map((ep) => (
              <View key={ep} style={{ flexDirection: 'row', marginBottom: GAP }}>
                {seasons.map((season) => {
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
                        !exists
                          ? s.absent
                          : v == null
                            ? { backgroundColor: blank }
                            : { backgroundColor: BANDS[ratingBand(v)] },
                      ]}>
                      {v != null && (
                        <Text style={[s.cellText, { color: INK[ratingBand(v)] }]}>
                          {decimal ? v.toFixed(1) : v}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </Scroller>
      </View>
  );

  return (
    <View style={s.wrap}>
      {!!note && <Text style={s.note}>{note}</Text>}
      {/* The row labels sit OUTSIDE the horizontal scroller so they stay put
          while the seasons move — a grid whose episode numbers scroll away is
          a grid you have to count. Each BLOCK carries its own, so a split grid
          is readable in every column of it. */}
      <View style={{ flexDirection: 'row', gap: maxRows ? 18 : 0, alignItems: 'flex-start' }}>
        {chunks.map((c, i) => block(c, i))}
      </View>
    </View>
  );
}

/** A horizontal scroller on the page, a plain view in a picture. */
function Scroller({ horizontal, children }: { horizontal: boolean; children: React.ReactNode }) {
  return horizontal ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View>{children}</View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingBottom: 12 },
  note: { color: colors.dim, fontSize: 12.5, paddingBottom: 10 },
  emptyText: { color: colors.dim, fontSize: 13, paddingTop: 10 },
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
  cellText: { fontSize: 14, fontWeight: '800' },
  /** Rated by nobody: present, and plainly blank. */
  empty: { backgroundColor: 'rgba(255,255,255,0.06)' },
  /** Not an episode at all. Fainter still, so the eye skips it. */
  absent: { backgroundColor: 'transparent' },
});
