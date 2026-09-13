import { render, screen } from '@testing-library/react';
import AdminFoodList from './components/AdminFoodList';

jest.mock('./components/AdminFoodList', () => () => <div>Food Order Admin</div>);

test('renders Food Order admin app', () => {
  render(<AdminFoodList />);
  expect(screen.getByText(/Food Order Admin/i)).toBeInTheDocument();
});
