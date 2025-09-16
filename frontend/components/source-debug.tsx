import { Card, CardContent } from "@/components/ui/card"

interface SourceDebugProps {
  data: unknown
}

const SourceDebug = ({ data }: SourceDebugProps) => {
  return (
    <Card className="max-w-2xl mx-auto my-8">
      <CardContent>
        <pre className="text-xs whitespace-pre-wrap break-all bg-muted rounded p-4 overflow-x-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CardContent>
    </Card>
  )
}

export default SourceDebug
