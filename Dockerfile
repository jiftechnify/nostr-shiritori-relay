FROM public.ecr.aws/docker/library/golang:1.21.3-alpine AS build
WORKDIR /go/src
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 go build -o /go/bin/shiritori -ldflags '-extldflags "-static"' cmd/shiritori/main.go 

FROM pluja/strfry:0.9.6
COPY --from=build /go/bin/* /app/plugin/
WORKDIR /app
EXPOSE 7777
ENTRYPOINT ["/app/strfry"]
CMD ["relay"]
