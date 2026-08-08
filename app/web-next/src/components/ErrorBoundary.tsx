import { Component, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <Result
          status="error"
          title="发生了意外错误"
          subTitle={this.state.error.message}
          extra={
            <Button onClick={this.handleReset}>重试</Button>
          }
        />
      );
    }

    return this.props.children;
  }
}
