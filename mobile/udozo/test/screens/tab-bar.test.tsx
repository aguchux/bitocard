import { fireEvent, screen } from '@testing-library/react-native';

import { UdozoTabBar } from '@/components/tab-bar';

import { answers, renderScreen } from './helpers';

// The navigator's pieces the bar is handed: the five tabs, their titles, the press events and the move to a tab.
const names = ['index', 'search', 'sell', 'chats', 'me'];
const titles: Record<string, string> = { index: 'Home', search: 'Search', sell: 'Sell', chats: 'Chats', me: 'Me' };

function bar(index = 0, options: Record<string, object> = {}) {
  const routes = names.map(name => ({ key: `${name}-key`, name }));
  const descriptors = Object.fromEntries(routes.map(route => [route.key, { options: { title: titles[route.name], ...(options[route.name] ?? {}) } }]));
  const emitter = { emit: jest.fn(() => ({ defaultPrevented: false })) };
  const navigateToTab = jest.fn();
  const props = { state: { index, routes }, descriptors, emitter, navigateToTab, insets: { top: 0, bottom: 24, left: 0, right: 0 } };
  return { props: props as unknown as Parameters<typeof UdozoTabBar>[0], emitter, navigateToTab };
}

beforeEach(() => answers({}));

describe('the tab bar', () => {
  it('draws the five tabs, Sell as the circle in the middle', async () => {
    const { props } = bar();
    await renderScreen(<UdozoTabBar {...props} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.props.accessibilityLabel)).toEqual(['Home', 'Search', 'Sell', 'Chats', 'Me']);
    expect(screen.getByTestId('tab-sell').props.accessibilityLabel).toBe('Sell');
  });

  it('opens Sell from the circle', async () => {
    const { props, emitter, navigateToTab } = bar(0);
    await renderScreen(<UdozoTabBar {...props} />);
    fireEvent.press(screen.getByTestId('tab-sell'));
    expect(emitter.emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'sell-key', canPreventDefault: true });
    expect(navigateToTab).toHaveBeenCalledWith('sell-key');
  });

  it('marks the tab shown as selected, and pressing it again moves nowhere', async () => {
    const { props, navigateToTab } = bar(3);
    await renderScreen(<UdozoTabBar {...props} />);
    expect(screen.getByTestId('tab-chats').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('tab-index').props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('tab-sell').props.accessibilityState).toEqual({ selected: false });
    fireEvent.press(screen.getByTestId('tab-chats'));
    expect(navigateToTab).not.toHaveBeenCalled();
  });

  it('shows a badge where a tab has one', async () => {
    const { props } = bar(0, { chats: { tabBarBadge: 3 } });
    await renderScreen(<UdozoTabBar {...props} />);
    expect(screen.getByTestId('tab-chats').props.accessibilityLabel).toBe('Chats, 3 new');
    expect(screen.getByText('3')).toBeTruthy();
  });
});
