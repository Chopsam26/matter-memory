import { redirect } from 'next/navigation';

export default function Home() {
  // Becomes '/query' at step 7, once that page exists.
  redirect('/upload');
}
