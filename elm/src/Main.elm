module Main exposing (Effect(..), Model, Msg(..), init, main, update, view)

import Browser
import Browser.Navigation as Navigation
import Html exposing (Html, a, button, div, h1, header, main_, span, text)
import Html.Attributes exposing (class, href, type_)
import Html.Events exposing (onClick)
import Url exposing (Url)


type Route
    = Home
    | Settings
    | PendingMigration String


type alias Model =
    { route : Route
    , navigationPreview : Bool
    }


type alias RuntimeModel =
    { key : Navigation.Key
    , app : Model
    }


type Msg
    = LinkClicked Browser.UrlRequest
    | UrlChanged Url
    | ToggledNavigationPreview


type Effect
    = NoEffect
    | PushUrl String
    | LoadExternal String


main : Program () RuntimeModel Msg
main =
    Browser.application
        { init = runtimeInit
        , onUrlChange = UrlChanged
        , onUrlRequest = LinkClicked
        , subscriptions = always Sub.none
        , update = runtimeUpdate
        , view = .app >> view
        }


init : () -> Url -> ignoredKey -> ( Model, Effect )
init _ url _ =
    ( { route = routeFromUrl url
      , navigationPreview = False
      }
    , NoEffect
    )


runtimeInit : () -> Url -> Navigation.Key -> ( RuntimeModel, Cmd Msg )
runtimeInit flags url key =
    let
        ( model, effect ) =
            init flags url ()
    in
    ( { key = key, app = model }, perform key effect )


routeFromUrl : Url -> Route
routeFromUrl url =
    case url.path of
        "/" ->
            Home

        "/settings" ->
            Settings

        path ->
            PendingMigration path


update : Msg -> Model -> ( Model, Effect )
update msg model =
    case msg of
        LinkClicked request ->
            case request of
                Browser.Internal url ->
                    ( model, PushUrl (Url.toString url) )

                Browser.External url ->
                    ( model, LoadExternal url )

        UrlChanged url ->
            ( { model | route = routeFromUrl url }, NoEffect )

        ToggledNavigationPreview ->
            ( { model | navigationPreview = not model.navigationPreview }, NoEffect )


runtimeUpdate : Msg -> RuntimeModel -> ( RuntimeModel, Cmd Msg )
runtimeUpdate msg runtime =
    let
        ( app, effect ) =
            update msg runtime.app
    in
    ( { runtime | app = app }, perform runtime.key effect )


perform : Navigation.Key -> Effect -> Cmd Msg
perform key effect =
    case effect of
        NoEffect ->
            Cmd.none

        PushUrl url ->
            Navigation.pushUrl key url

        LoadExternal url ->
            Navigation.load url


view : Model -> Browser.Document Msg
view model =
    { title = "Hunker · Elm migration"
    , body =
        [ main_
            [ class "elm-migration-shell" ]
            [ header []
                [ a [ href "/", class "brand" ]
                    [ span [ class "brand-mark" ] [ text "H" ]
                    , span [] [ text "hunker" ]
                    ]
                , a [ href "/settings" ] [ text "Settings" ]
                ]
            , div []
                [ h1 [] [ text (routeTitle model.route) ]
                , button
                    [ type_ "button", onClick ToggledNavigationPreview ]
                    [ text "Toggle navigation preview" ]
                , div []
                    [ text
                        (if model.navigationPreview then
                            "Elm update branch is active"

                         else
                            "Elm update branch is idle"
                        )
                    ]
                ]
            ]
        ]
    }


routeTitle : Route -> String
routeTitle route =
    case route of
        Home ->
            "Local repositories"

        Settings ->
            "Hunker settings"

        PendingMigration path ->
            "Migrating " ++ path
