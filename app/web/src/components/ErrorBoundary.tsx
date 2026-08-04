import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

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
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertTriangle className="size-8 text-destructive" />
          <p className="text-sm text-muted-foreground">发生了意外错误</p>
          <p className="max-w-sm text-xs text-muted-foreground/60">
            {this.state.error.message}
          </p>
          <Button variant="outline" size="sm" onClick={this.handleReset}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
