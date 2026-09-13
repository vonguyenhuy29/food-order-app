import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./components/FoodList', () => () => <div>Food Order User</div>);

test('renders Food Order user app', () => {
  render(<App />);
  expect(screen.getByText(/Food Order User/i)).toBeInTheDocument();
});
