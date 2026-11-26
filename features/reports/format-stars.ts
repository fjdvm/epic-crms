/** "4.3 / 5", or a dash when nothing was rated. */
export const formatStars = (rating: number | null) => (rating === null ? "—" : `${rating.toFixed(1)} / 5`);
