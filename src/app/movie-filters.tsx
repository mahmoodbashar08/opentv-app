import { FiltersSheet } from '@/components/filters-sheet';

/** The Movies library filter sheet -- same component as Shows, minus the axes
 *  films have no data for (a film has no network, so the section is absent
 *  rather than present and inert). */
export default function MovieFiltersRoute() {
  return <FiltersSheet kind="movie" />;
}
