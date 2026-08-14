import { FiltersSheet } from '@/components/filters-sheet';

/** The Shows library filter sheet. Everything lives in the shared component so
 *  the two library sheets cannot drift. */
export default function ShowFiltersRoute() {
  return <FiltersSheet kind="show" />;
}
